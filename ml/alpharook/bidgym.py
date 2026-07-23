"""The BIDDING GYM (Riley's design, 2026-07-23): Rook at auction speed.

Full games of nothing but auctions. Real decks are dealt, four copies of
the learning bid net fight the auction under the real engine's rules, and
the moment a contract resolves the hand's 9 tricks are replaced by one
sample from the OUTCOME MODEL — a distribution learned from millions of
actually-played hands. Scores race; dealers rotate; thousands of games a
second instead of tens.

What the bid net sees that no AlphaRook ever saw: its DEALER-RELATIVE
position — so it finally knows who leads trick one when it prices a bid
(the gap Riley found). What it experiences that nature never provides:
the SCORE CURRICULUM — a slice of episodes starts at a random score state
including the endgames, so "never gamble the lead at 495" gets the same
data density as an opening bid instead of one lesson per thousand games.

Bracket variants (Riley's 2-hour-bracket plan):
  --lose-score -250   the family game (sets can lose you the game)
  --no-floor          Riley's anti-pacifism rule: no floor, no winning by
                      setting — the only exit is +500 of your own points,
                      so never-bidding is mathematically losing.

    python -m alpharook.bidgym --run bid-a --outcome models/outcome.pt
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from rook.cards import PASS, VALID_BIDS, create_deck, team_of
from rook.engine import Game, BIDDING, REDEAL, bid_lead
from .outcome_model import load_outcome

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"

WIN = 500
POOL = 120.0
# state: hand(40) + suit-lengths(4)/9 + bids per rel seat(12) + high/120 +
# must-bid + floor/120 + score geometry(6) + hand#(1) + dealer-rel(4)
STATE_DIM = 70
ACT_DIM = 2  # [is_pass, bid/120]


class BidNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(STATE_DIM + ACT_DIM, 128), nn.ReLU(),
            nn.Linear(128, 128), nn.ReLU(),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, s, a):
        return self.net(torch.cat([s, a], -1)).squeeze(-1)


def load_bidnet(path: str) -> BidNet:
    net = BidNet()
    ck = torch.load(path, map_location="cpu", weights_only=True)
    net.load_state_dict(ck["model"] if "model" in ck else ck)
    net.eval()
    return net


def bid_state(g: Game, seat: int, scores, win_score, lose_score,
              hand_no: int) -> np.ndarray:
    x = np.zeros(STATE_DIM, dtype=np.float32)
    for c in g.hands[seat]:
        x[c] = 1.0
    base = 40
    for c in g.hands[seat]:
        x[base + c // 10] += 1.0 / 9.0
    base += 4
    for i in range(4):
        s2 = (seat + 1 + i) % 4
        b = g.bids[s2]
        if b is None:
            x[base] = 1.0
        elif b == PASS:
            x[base + 1] = 1.0
        else:
            x[base + 2] = b / 120.0
        base += 3
    x[base] = (g.high_bid or 0) / 120.0
    x[base + 1] = 1.0 if g.must_bid() else 0.0
    floor = g.min_next_bid()
    x[base + 2] = (floor or 0) / 120.0
    base += 3
    team = team_of(seat)
    mine, theirs = scores[team], scores[1 - team]
    span = win_score - lose_score
    x[base] = mine / win_score
    x[base + 1] = theirs / win_score
    x[base + 2] = (win_score - mine) / span
    x[base + 3] = (win_score - theirs) / span
    x[base + 4] = max(0.0, (mine - lose_score) / span)
    x[base + 5] = max(0.0, (theirs - lose_score) / span)
    x[base + 6] = min(hand_no, 20) / 20.0
    base += 7
    # THE new sense: dealer-relative position. rel 0 = I am the dealer
    # (I bid last, I am the must-bid fallback, the seat to my left leads
    # trick one); rel 3 = I lead trick one.
    x[base + (g.dealer - seat) % 4] = 1.0
    return x


def act_vec(bid) -> np.ndarray:
    return np.array([1.0, 0.0] if bid == PASS else [0.0, bid / 120.0],
                    dtype=np.float32)


def score_hand(bid: int, decl_pts: float, bid_team: int):
    """Family scoring from a sampled outcome."""
    made = decl_pts >= bid
    hs = [0.0, 0.0]
    hs[bid_team] = decl_pts if made else -bid
    hs[1 - bid_team] = POOL - decl_pts
    return hs, not made


class AuctionEpisode:
    """One score-race of auction-only hands."""

    def __init__(self, rng, outcome, win_score, lose_score, no_set_wins,
                 start_scores=(0, 0), dealer=None, max_hands: int = 60):
        self.rng = rng
        self.outcome = outcome
        self.win = win_score
        self.lose = lose_score
        self.no_set_wins = no_set_wins
        # under the no-floor rule an all-sets table can drift downward
        # forever (untrained nets do exactly this); a 60-hand race is
        # degenerate anyway — cap it, higher score takes it
        self.max_hands = max_hands
        self.scores = list(start_scores)
        self.dealer = rng.randrange(4) if dealer is None else dealer
        self.hand_no = 1
        self.winner = None
        self._new_hand()

    def _new_hand(self):
        while True:
            self.g = Game(dealer=self.dealer, win_score=10 ** 9,
                          lose_score=-(10 ** 9))
            deck = create_deck()
            self.rng.shuffle(deck)
            self.g.deal(deck)
            if self.g.phase != REDEAL:
                break

    @property
    def done(self):
        return self.winner is not None

    def bidder(self):
        return self.g.turn

    def apply_bid(self, bid):
        self.g.bid(self.g.turn, bid)
        if self.g.phase == BIDDING:
            return None
        # auction resolved: replace nine tricks with one sample
        w = self.g.bid_winner
        decl = self.outcome.sample_points(
            sorted(self.g.hands[w]), sorted(self.g.widow), self.rng)
        hs, went_set = score_hand(self.g.high_bid, decl, team_of(w))
        self.scores[0] += hs[0]
        self.scores[1] += hs[1]
        over = (max(self.scores) >= self.win
                or (not self.no_set_wins and min(self.scores) <= self.lose))
        if (over or self.hand_no >= self.max_hands) \
                and self.scores[0] != self.scores[1]:
            self.winner = 0 if self.scores[0] > self.scores[1] else 1
        else:
            self.hand_no += 1
            self.dealer = (self.dealer + 1) % 4
            self._new_hand()
        return hs


def cands_for(g: Game):
    floor = g.min_next_bid()
    if floor is None:
        return [PASS]
    c = [b for b in VALID_BIDS if b >= floor]
    if not g.must_bid():
        c = [PASS] + c
    return c


# --------------------------------------------------------------------------

def run_episode(net, ep: AuctionEpisode, eps: float, rng, rows=None):
    """Play one score-race; optionally collect training rows. Each bid is
    labeled 0.5 * its hand's score swing + 0.5 * the race outcome."""
    pending = []  # this hand's decisions, awaiting the hand result
    while not ep.done:
        seat = ep.bidder()
        cands = cands_for(ep.g)
        s = bid_state(ep.g, seat, ep.scores, ep.win, ep.lose, ep.hand_no)
        if len(cands) == 1:
            j = 0
        elif rng.random() < eps:
            j = rng.randrange(len(cands))
        else:
            S = torch.from_numpy(np.stack([s] * len(cands)))
            A = torch.from_numpy(np.stack([act_vec(b) for b in cands]))
            with torch.no_grad():
                j = int(net(S, A).argmax().item())
        if rows is not None:
            pending.append((s, act_vec(cands[j]), team_of(seat)))
        hs = ep.apply_bid(cands[j])
        if hs is not None and rows is not None:
            for s_v, a_v, team in pending:
                hand_t = max(-1.0, min(1.0, (hs[team] - hs[1 - team]) / 200.0))
                rows.append([s_v, a_v, team, hand_t, None])
            pending = []
    if rows is not None:
        for r in rows:
            if r[4] is None:
                wl = 1.0 if ep.winner == r[2] else -1.0
                d = (ep.scores[r[2]] - ep.scores[1 - r[2]]) / ep.win
                game_t = 0.7 * wl + 0.3 * max(-1.0, min(1.0, d))
                r[4] = 0.5 * r[3] + 0.5 * game_t
    return ep


def start_state(rng, curriculum: float):
    """Score curriculum: most episodes start 0-0; a slice starts anywhere,
    endgames deliberately common."""
    if rng.random() >= curriculum:
        return (0, 0)
    if rng.random() < 0.5:  # endgame block
        a = rng.choice([455, 465, 475, 485, 495])
        b = rng.randrange(0, 500, 5)
    else:
        a = rng.randrange(0, 500, 5)
        b = rng.randrange(0, 500, 5)
    return (a, b) if rng.random() < 0.5 else (b, a)


def battery(net, outcome, heur_net, deals: int = 400, seed: int = 777,
            win=WIN, lose=-250, no_floor=False) -> float:
    """Fixed-seed score-race battery: net team (seats 0,2) vs opponent
    bidder (seats 1,3), greedy, seeded outcome sampling — the ruler."""
    wins = 0
    for k in range(deals):
        rng = random.Random(seed + k * 9973)
        ep = AuctionEpisode(rng, outcome, win, lose, no_floor,
                            start_scores=start_state(rng, 0.5),
                            dealer=k % 4)
        while not ep.done:
            seat = ep.bidder()
            cands = cands_for(ep.g)
            use = net if seat % 2 == 0 else heur_net
            if len(cands) == 1:
                j = 0
            else:
                s = bid_state(ep.g, seat, ep.scores, ep.win, ep.lose,
                              ep.hand_no)
                S = torch.from_numpy(np.stack([s] * len(cands)))
                A = torch.from_numpy(np.stack([act_vec(b) for b in cands]))
                with torch.no_grad():
                    j = int(use(S, A).argmax().item())
            ep.apply_bid(cands[j])
        wins += 1 if ep.winner == 0 else 0
    return wins / deals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="bid-a")
    ap.add_argument("--outcome", default="models/outcome.pt")
    ap.add_argument("--iters", type=int, default=100000)
    ap.add_argument("--games-per-iter", type=int, default=200)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--eps-start", type=float, default=0.20)
    ap.add_argument("--eps-end", type=float, default=0.05)
    ap.add_argument("--eps-decay-iters", type=int, default=300)
    ap.add_argument("--curriculum", type=float, default=0.35,
                    help="fraction of episodes starting at a random score "
                         "state (half of those in the endgame block)")
    ap.add_argument("--lose-score", type=int, default=-250)
    ap.add_argument("--no-floor", action="store_true",
                    help="Riley's rule: no floor, no winning by setting")
    ap.add_argument("--eval-every", type=int, default=25)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    outcome = load_outcome(args.outcome)
    net = BidNet()
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    start_iter, best = 0, -1.0
    latest = run_dir / "latest.pt"
    if args.resume and latest.exists():
        ck = torch.load(latest, map_location="cpu", weights_only=True)
        net.load_state_dict(ck["model"]); opt.load_state_dict(ck["opt"])
        start_iter = ck["iter"] + 1; best = ck.get("best", -1.0)
        print(f"resumed {args.run} at iter {start_iter}")
    frozen0 = BidNet(); frozen0.load_state_dict(net.state_dict())

    def log(rec):
        rec["ts"] = time.time()
        with open(run_dir / "log.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")

    for it in range(start_iter, args.iters):
        t0 = time.time()
        eps = (args.eps_end if it >= args.eps_decay_iters else
               args.eps_start + (args.eps_end - args.eps_start)
               * it / args.eps_decay_iters)
        rows: list = []
        sets = hands = 0
        net.eval()
        for _ in range(args.games_per_iter):
            ep = AuctionEpisode(rng, outcome, WIN, args.lose_score,
                                args.no_floor,
                                start_scores=start_state(rng, args.curriculum))
            run_episode(net, ep, eps, rng, rows)
            hands += ep.hand_no
        S = torch.from_numpy(np.stack([r[0] for r in rows]))
        A = torch.from_numpy(np.stack([r[1] for r in rows]))
        Y = torch.tensor([r[4] for r in rows], dtype=torch.float32)
        net.train()
        losses = []
        for _ in range(args.epochs):
            p = torch.randperm(len(Y))
            for i in range(0, len(Y), args.batch_size):
                idx = p[i:i + args.batch_size]
                loss = nn.functional.mse_loss(net(S[idx], A[idx]), Y[idx])
                opt.zero_grad(); loss.backward(); opt.step()
                losses.append(loss.item())
        rec = {"iter": it, "loss": round(float(np.mean(losses)), 5),
               "rows": len(Y), "hands": hands,
               "sec": round(time.time() - t0, 1)}
        if it % args.eval_every == 0 or it == args.iters - 1:
            net.eval()
            wr = battery(net, outcome, frozen0, deals=300,
                         lose=args.lose_score, no_floor=args.no_floor)
            rec["battery_vs_init"] = round(wr, 3)
            torch.save({"model": net.state_dict(), "opt": opt.state_dict(),
                        "iter": it, "best": best}, latest)
            if wr > best:
                best = wr
                torch.save({"model": net.state_dict(), "iter": it,
                            "battery": wr}, run_dir / "best.pt")
        print(f"[{args.run} it {it}] loss {rec['loss']:.4f} "
              f"{len(Y)} rows {hands} hands {rec['sec']}s"
              + (f"  BATTERY vs init: {rec.get('battery_vs_init'):.1%}"
                 if 'battery_vs_init' in rec else ""), flush=True)
        log(rec)
    print("done.")


if __name__ == "__main__":
    main()
