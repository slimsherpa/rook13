"""BidBrain — the best-response bidder: P(win the game | situation, bid),
learned from millions of real -250/+500 games against the frozen house.

gen23's auction is a FROZEN, deterministic policy — frozen policies are
not equilibria; they have a best response. Three attacker classes failed
to find it (formula evolution: blind evaluator; rollout oracle: winner's
curse at laptop K; Q-nudges: too timid, position-deaf). BidBrain is the
fourth: no formula, no world-sampling at decision time, no nudging —
just the empirical win-probability curve over bids, and its argmax.

THE FIVE FACTORS (Riley's spec, 2026-07-31 — each articulated as a
feature block; this ordering is the documentation of the strategy):

  1. THE SCORECARD — "am I ahead, am I behind, what's going on."
     Raw scores, the difference, the fitted P(win | score) prior
     (winprob24 — the gene cities' 1.36M-game bequest), cliff flags
     (one set from -250 death), closing flags (>= 350).
  2. POSITION — "who dealt? bidding first sets the tone, and the opener
     leads trick 1." Voice order one-hot, and the tempo triad: do I
     lead the first trick, does my partner, or does an opponent.
     (No previous attacker had ANY of this.)
  3. MY HAND — "good hand? bad? bluffable? a setting hand? a slam
     dunk?" All 40 card bits raw — the net builds its own evaluator;
     per-suit counts / points / top honor; the family estimate_tricks
     demoted from oracle to hint.
  4. THE TABLE TALK — "what have their bids told me? what has my
     partner said?" Per-relative-seat auction record (has bid, max
     bid, first bid, passed), the standing high bid and floor, who
     holds it, must-bid flag.
  5. THE WAGER — "set my bid and hope." The candidate itself: level,
     distance over the floor, jump flag, would-a-set-end-the-game,
     could-making-close-the-game. Bluffs, sandbags and hero-calls are
     not special cases — they are just points on the learned curve
     that the argmax picks when the data says they win.

Training data (bidbrain_data.py): both teams' decisions in every game,
one team bidding with epsilon=0.3 uniform exploration so the corpus
CONTAINS the counterfactuals ("what if I had bluffed here?"), each row
labeled with its team's final game outcome. Monte-Carlo Q of the
near-house policy; argmax = one-step policy improvement vs the house.

    ~/torch-env/bin/python -m alpharook.bidbrain train --epochs 2
    ~/torch-env/bin/python -m alpharook.bidbrain gate --pairs 1000 --workers 8

Law (extended after the pairs-league mirage): nothing is believed under
1,000 pairs, family format only.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import time

import numpy as np
import torch
import torch.nn as nn

from rook.cards import (
    PASS, SEATS, VALID_BIDS, suit_of, num_of, card_points, team_of,
    partner_of,
)
from rook.engine import bid_lead
from rook.bots import estimate_tricks
from .winprob import WinProb

FEAT_DIM = 95
MODEL_PATH = "models/bidbrain-v1.pt"
SHARDS = "runs/gen24/bidbrain/shards"

_WP = None


def _wp():
    global _WP
    if _WP is None:
        _WP = WinProb()
    return _WP


def featurize(hand, bid_hist, dealer, seat, my_score, opp_score, hand_no,
              cand, win_score=500, lose_score=-250):
    """One (situation, candidate-bid) -> 95 floats. Blocks follow the five
    factors documented above, in order."""
    f = np.zeros(FEAT_DIM, dtype=np.float32)
    i = 0

    # -- 1. THE SCORECARD (9) ------------------------------------------
    f[i] = my_score / 500.0
    f[i + 1] = opp_score / 500.0
    f[i + 2] = (my_score - opp_score) / 500.0
    f[i + 3] = _wp()(my_score, opp_score, win_score, lose_score)
    f[i + 4] = 1.0 if my_score <= -130 else 0.0    # one set from the cliff
    f[i + 5] = 1.0 if opp_score <= -130 else 0.0
    f[i + 6] = 1.0 if my_score >= 350 else 0.0     # closing range
    f[i + 7] = 1.0 if opp_score >= 350 else 0.0
    f[i + 8] = min(1.0, hand_no / 20.0)
    i += 9

    # -- 2. POSITION (7) -----------------------------------------------
    opener = bid_lead(dealer)
    voice = (seat - opener) % 4          # 0 = I set the tone
    f[i + voice] = 1.0
    i += 4
    f[i] = 1.0 if seat == opener else 0.0            # I lead trick 1
    f[i + 1] = 1.0 if partner_of(seat) == opener else 0.0
    f[i + 2] = 1.0 if team_of(opener) != team_of(seat) else 0.0
    i += 3

    # -- 3. MY HAND (53) -----------------------------------------------
    for c in hand:
        f[i + c] = 1.0
    i += 40
    for s in range(4):
        cards = [c for c in hand if suit_of(c) == s]
        f[i + s] = len(cards) / 9.0
        f[i + 4 + s] = sum(card_points(c) for c in cards) / 20.0
        f[i + 8 + s] = (max(num_of(c) for c in cards) / 14.0) if cards else 0.0
    i += 12
    f[i] = estimate_tricks(list(hand)) / 9.0         # the old oracle, demoted
    i += 1

    # -- 4. THE TABLE TALK (20) ----------------------------------------
    per_seat = {}
    for s2, b in bid_hist:
        e = per_seat.setdefault(s2, dict(first=None, mx=None, passed=False))
        if b == PASS:
            if e["mx"] is None:
                e["passed"] = True
        else:
            e["mx"] = b if e["mx"] is None else max(e["mx"], b)
            if e["first"] is None:
                e["first"] = b
    high = max((e["mx"] for e in per_seat.values() if e["mx"]), default=None)
    high_holder = None
    for s2, e in per_seat.items():
        if e["mx"] is not None and e["mx"] == high:
            high_holder = s2
    for k, s2 in enumerate((partner_of(seat), (seat + 1) % 4, (seat + 3) % 4)):
        e = per_seat.get(s2)
        f[i + 4 * k] = 1.0 if e and e["mx"] is not None else 0.0
        f[i + 4 * k + 1] = (e["mx"] / 120.0) if e and e["mx"] else 0.0
        f[i + 4 * k + 2] = (e["first"] / 120.0) if e and e["first"] else 0.0
        f[i + 4 * k + 3] = 1.0 if e and e["passed"] else 0.0
    i += 12
    floor = 65 if high is None else high + 5
    f[i] = (high or 0) / 120.0
    f[i + 1] = floor / 120.0 if floor <= 120 else 1.0
    i += 2
    if high_holder is None:
        f[i] = 1.0
    elif high_holder == seat:
        f[i + 1] = 1.0
    elif high_holder == partner_of(seat):
        f[i + 2] = 1.0
    else:
        f[i + 3] = 1.0
    i += 4
    f[i] = len(bid_hist) / 10.0
    n_passes = sum(1 for _s, b in bid_hist if b == PASS)
    f[i + 1] = 1.0 if (n_passes == 3 and high is None) else 0.0  # must-bid
    i += 2

    # -- 5. THE WAGER (6) ----------------------------------------------
    if cand == PASS:
        f[i] = 1.0
    else:
        f[i + 1] = cand / 120.0
        f[i + 2] = (cand - floor) / 55.0
        f[i + 3] = 1.0 if cand > floor else 0.0                  # jump
        f[i + 4] = 1.0 if my_score - cand <= lose_score else 0.0  # death set
        f[i + 5] = 1.0 if my_score + cand >= win_score else 0.0   # can close
    i += 6
    assert i == FEAT_DIM
    return f


class BidBrainNet(nn.Module):
    def __init__(self, dim: int = FEAT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


def load_brain(path: str = MODEL_PATH) -> BidBrainNet:
    net = BidBrainNet()
    net.load_state_dict(torch.load(path, map_location="cpu",
                                   weights_only=True))
    net.eval()
    return net


# ---------------------------------------------------------------------------
# Training: stream complete shards, hold out the newest for validation
# ---------------------------------------------------------------------------


def _shard_arrays(path: str, dev_weight: float = 20.0):
    """X, y, sample-weights. Deviation rows are upweighted hard: house
    rows are CONFOUNDED for the action-effect (gen23 bids 120 only with
    monsters, so 'bid 120' correlates with winning without causing it) —
    the v0peek net bought 736 contracts at 120 and won 2% of games by
    learning exactly that correlation. The uniformly-random deviation rows
    are the only causal support for off-policy bids; at ~4% of rows they
    need ~20x weight to shape the candidate-conditional."""
    X, Y, W = [], [], []
    with open(path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            w = rec["w"]
            for r in rec["rows"]:
                t = r["t"]
                my, opp = r["sc"][t], r["sc"][1 - t]
                X.append(featurize(r["h"], r["bh"], r["d"], r["s"],
                                   my, opp, r["hn"], r["a"]))
                Y.append(1.0 if w == t else 0.0)
                W.append(dev_weight if r.get("r") else 1.0)
    return (np.stack(X), np.array(Y, dtype=np.float32),
            np.array(W, dtype=np.float32))


def train(args):
    shards = sorted(glob.glob(os.path.join(args.shards, "*.jsonl")))
    assert len(shards) >= 4, f"only {len(shards)} complete shards"
    val_shards = shards[-2:]
    tr_shards = shards[:-2]
    print(f"{len(tr_shards)} train shards, {len(val_shards)} val", flush=True)

    dev = ("mps" if torch.backends.mps.is_available() else "cpu")
    net = BidBrainNet().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr,
                           weight_decay=1e-5)
    lossf = nn.BCEWithLogitsLoss(reduction="none")

    vparts = [_shard_arrays(p, args.dev_weight) for p in val_shards]
    Xv = torch.from_numpy(np.concatenate([v[0] for v in vparts])).to(dev)
    Yv = torch.from_numpy(np.concatenate([v[1] for v in vparts])).to(dev)
    Mv = torch.from_numpy(np.concatenate([v[2] for v in vparts])).to(dev) > 1
    print(f"val rows: {len(Yv):,} ({int(Mv.sum())} deviation rows)",
          flush=True)

    step = 0
    t0 = time.time()
    rng = random.Random(13)
    for epoch in range(args.epochs):
        order = list(tr_shards)
        rng.shuffle(order)
        for sp in order:
            X, Y, W = _shard_arrays(sp, args.dev_weight)
            idx = np.random.permutation(len(Y))
            X, Y, W = X[idx], Y[idx], W[idx]
            for k in range(0, len(Y), args.batch):
                xb = torch.from_numpy(X[k:k + args.batch]).to(dev)
                yb = torch.from_numpy(Y[k:k + args.batch]).to(dev)
                wb = torch.from_numpy(W[k:k + args.batch]).to(dev)
                opt.zero_grad()
                loss = (lossf(net(xb), yb) * wb).sum() / wb.sum()
                loss.backward()
                opt.step()
                step += 1
            if step % 200 < len(Y) // args.batch + 1:
                with torch.no_grad():
                    p = net(Xv)
                    vl = lossf(p, Yv).mean().item()
                    # the number that matters: loss on CAUSAL rows only
                    dl = lossf(p[Mv], Yv[Mv]).mean().item()
                print(f"  epoch {epoch} step {step}: val logloss {vl:.4f} "
                      f"| deviation-row logloss {dl:.4f} "
                      f"({time.time() - t0:.0f}s)", flush=True)
                torch.save(net.state_dict(), args.out)
    with torch.no_grad():
        p = net(Xv)
        vl = lossf(p, Yv).mean().item()
        dl = lossf(p[Mv], Yv[Mv]).mean().item()
    torch.save(net.state_dict(), args.out)
    print(f"final val logloss {vl:.4f} (deviation rows {dl:.4f}) "
          f"-> {args.out}", flush=True)


# ---------------------------------------------------------------------------
# The bidder + the 1,000-pair gate
# ---------------------------------------------------------------------------


class BrainBidder:
    def __init__(self, path: str = MODEL_PATH):
        self.net = load_brain(path)

    @torch.no_grad()
    def bid(self, g, seat: int, cands) -> int:
        if len(cands) == 1:
            return cands[0]
        me = team_of(seat)
        X = np.stack([featurize(sorted(g.hands[seat]), g.bid_history,
                                g.dealer, seat, g.scores[me],
                                g.scores[1 - me], g.hand_number, c,
                                g.win_score, g.lose_score)
                      for c in cands])
        q = self.net(torch.from_numpy(X)).numpy()
        return cands[int(np.argmax(q))]


_G: dict = {}


def _gate_init(net_path: str, brain_path: str):
    torch.set_num_threads(1)
    from .model import load_qnet
    _G["net"] = load_qnet(net_path)
    _G["brain"] = BrainBidder(brain_path)


def _gate_pair(pair_seed: int):
    from .bidcity import play_bid_game
    out = []
    for flip in (False, True):
        w, d, st, _ = play_bid_game(_G["net"], _G["brain"], None,
                                    pair_seed, flip)
        out.append((w, d, st))
    return out


def gate(args):
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    seeds = [args.seed + p * 104729 + 77 for p in range(args.pairs)]
    a = b = 0
    pw = []
    auct = {0: dict(contracts=0, made=0, bid_sum=0),
            1: dict(contracts=0, made=0, bid_sum=0)}
    t0 = time.time()
    with ctx.Pool(args.workers, initializer=_gate_init,
                  initargs=(args.net, args.brain)) as pool:
        for n, games in enumerate(pool.imap_unordered(_gate_pair, seeds), 1):
            w_pair = 0
            for w, d, st in games:
                if w == 0:
                    a += 1
                    w_pair += 1
                else:
                    b += 1
                for i2 in (0, 1):
                    for k in auct[i2]:
                        auct[i2][k] += st[i2][k]
            pw.append(w_pair)
            if n % 50 == 0:
                print(f"  [{n}/{args.pairs}] brain {a}-{b} "
                      f"({a / (a + b):.1%}), {(time.time() - t0) / n:.1f}"
                      f"s/pair", flush=True)
    import statistics
    se = statistics.pstdev(pw) / math.sqrt(len(pw)) / 2
    games = a + b
    print(f"\nBIDBRAIN GATE — {args.pairs} pairs ({games} games, duplicate "
          f"decks, seats swapped), family format:")
    print(f"  brain: {a}/{games} = {a / games:.1%} ± {1.96 * se:.1%} "
          f"(95% CI, pair-level)")
    for i2, name in ((0, "brain"), (1, "gen23")):
        c = max(1, auct[i2]["contracts"])
        print(f"  {name}: {auct[i2]['contracts']} contracts, made "
              f"{auct[i2]['made'] / c:.0%}, avg bid "
              f"{auct[i2]['bid_sum'] / c:.1f}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    tp = sub.add_parser("train")
    tp.add_argument("--shards", default=SHARDS)
    tp.add_argument("--out", default=MODEL_PATH)
    tp.add_argument("--epochs", type=int, default=2)
    tp.add_argument("--batch", type=int, default=8192)
    tp.add_argument("--lr", type=float, default=1e-3)
    tp.add_argument("--dev-weight", type=float, default=20.0,
                    help="loss weight on causal (deviation) rows")
    gp = sub.add_parser("gate")
    gp.add_argument("--pairs", type=int, default=1000)
    gp.add_argument("--workers", type=int, default=8)
    gp.add_argument("--seed", type=int, default=0)
    gp.add_argument("--net", default="models/gen23-cand1.pt")
    gp.add_argument("--brain", default=MODEL_PATH)
    args = ap.parse_args()
    if args.cmd == "train":
        train(args)
    else:
        gate(args)


if __name__ == "__main__":
    main()
