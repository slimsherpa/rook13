"""gen20 — the HOT SEAT gym (Riley's design, 2026-07-22, Gardner family).

One ROLE per run is the HOT SEAT: its single goal is that its team captures
as many POINTS per hand as possible. No auction anywhere — every hand all
seats pass and the engine's must-bid rule forces the DEALER to open at the
minimum: the dealer is the taker, takes the widow, sets the go-down and
calls trump, and the dealer rotates so the hot ROLE (taker / left /
partner / right, relative to the taker) sweeps the absolute seats. The
other three seats are a FROZEN champion reflex.

Why this channel, after eight parities on the old one: a game-outcome
target spreads one noisy grade over ~45 decisions, and the early tricks —
where 75% of preventable blunders live — get the most diluted signal of
all. Here every decision is graded by ITS OWN HAND's raw captured points
(pool = 100 card points + 20 tricks bonus; the go-down rides on the last
trick), dense signal with no auction noise and no set/contract cliff.
DouZero itself trained role-specialists this way.

The hot seat's card play runs search AND reflex from trick 0, blended by
Riley's schedule: the Q-prior starts heavy (reflex-dominant while the
hidden hands are diffuse; search only overrides on strong evidence) and
decays by trick (search-dominant in the pinned-down endgame). Sharpening
the REFLEX on the early tricks is the point — the reflex banks the lesson.

Metric (Riley's spec): average points captured per hand by the hot team.
Logged per iteration from the training stream, and every --eval-every
iters an EVAL BATTERY replays the SAME fixed decks with the hot seat on
pure greedy reflex — "18.35 at the start, 23.61 later" becomes a
luck-free, apples-to-apples reading. Iteration 0's battery IS the
warm-start baseline.

    python -m alpharook.hotseat --run hot-partner --role partner \
        --belief runs/gen15/best_duel.pt --workers 7
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from rook.cards import PASS, team_of, create_deck
from rook.engine import (
    DEALING, REDEAL, HAND_DONE, TRUMP, TAKING_TRICKS_BONUS,
)
from rook.observation import observe
from .encoder import encode_state_for, encode_action, D_BID, D_PLAY
from .env import SelfPlayGame
from .model import load_qnet
from .selfplay import belief_target

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"

# hot role -> seat offset from the taker (the taker is always the dealer)
ROLE_OFFSET = {"taker": 0, "left": 1, "partner": 2, "right": 3}
POINT_POOL = 120.0  # 100 card points + 20 tricks bonus


class HotSeatGame(SelfPlayGame):
    """SelfPlayGame that records, per finished hand, (dealer, pts0, pts1)
    with pts = RAW captured points including the go-down (to the last-trick
    winner's team) and the tricks bonus — captured at HAND_DONE, before the
    engine folds them into set-aware hand scores and rotates the dealer."""

    def __init__(self, *args, **kw):
        self.hand_points: list[tuple[int, float, float]] = []
        super().__init__(*args, **kw)

    def _advance(self) -> None:  # full replacement of the parent's loop
        g = self.g
        while True:
            if g.phase in (DEALING, REDEAL):
                if self.deck_fn is not None:
                    deck = self.deck_fn(self.deal_count)
                else:
                    deck = create_deck()
                    self.rng.shuffle(deck)
                self.deal_count += 1
                g.deal(deck)
            elif g.phase == HAND_DONE:
                pts = list(g.points_taken)
                last_winner = g.completed_tricks[-1][2]
                pts[team_of(last_winner)] += g.go_down_points()
                if g.tricks_won[0] >= 5:
                    pts[0] += TAKING_TRICKS_BONUS
                if g.tricks_won[1] >= 5:
                    pts[1] += TAKING_TRICKS_BONUS
                self.hand_points.append((g.dealer, float(pts[0]), float(pts[1])))
                g.next_hand()
            elif g.phase == TRUMP and self.trump_intent is not None:
                g.select_trump(g.turn, self.trump_intent)
                self.trump_intent = None
            else:
                return


def scripted_bid(env: HotSeatGame, cands: list) -> int:
    """The no-auction auction: everyone passes; the engine's must-bid rule
    forces the dealer to open, and the minimum legal bid is the assignment."""
    if env.g.must_bid():
        return min(b for b in cands if b != PASS)
    return PASS


def reflex_pick(net, env, seat: int, dtype: int, cands: list) -> int:
    s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                         env.g, env.trump_intent)
    S = torch.from_numpy(np.stack([s] * len(cands)))
    A = torch.from_numpy(np.stack([encode_action(dtype, a) for a in cands]))
    with torch.no_grad():
        q = net(S, A)
    return int(q.argmax().item())


class HotSeatSelfPlay:
    """WorkerPool-compatible collector: same .play() contract and row format
    as VecSelfPlay/SearchSelfPlay, but rows come only from the hot seat and
    targets are per-hand captured points, normalized to [-1, 1]."""

    def __init__(self, seed: int = 0, role: str = "partner",
                 frozen_ckpt: str = "models/gen13.pt",
                 frozen_taker_ckpt: str | None = None,
                 hands_per_episode: int = 12, eps_godown: float = 0.05,
                 worlds: int = 8, prior_start: float = 12.0,
                 prior_end: float = 2.0,
                 belief_ckpt: str | None = None, belief_temp: float = 0.5):
        self.rng = random.Random(seed)
        self.role_offset = ROLE_OFFSET[role]
        self.hands_per_episode = hands_per_episode
        self.eps_godown = eps_godown
        self.worlds = worlds
        self.prior_start = prior_start
        self.prior_end = prior_end
        self.frozen = load_qnet(frozen_ckpt)
        # round-robin (lap 2+): the taker's chair can hold a FROZEN
        # improved specialist while the hot seat learns against it
        self.frozen_taker = (load_qnet(frozen_taker_ckpt)
                             if frozen_taker_ckpt else None)
        self.belief = None
        if belief_ckpt:
            from .beliefs import BeliefOracle
            self.belief = BeliefOracle(belief_ckpt, temp=belief_temp)
        self.agent = None
        self._agent_net = None
        self.games_done = 0  # episodes, for the pool's counter

    def _ensure_agent(self, net) -> None:
        if self._agent_net is not net:
            from .search import SearchAgent
            self.agent = SearchAgent(net, worlds=self.worlds,
                                     search_dtypes=frozenset({D_PLAY}),
                                     prior_weight=self.prior_start,
                                     prior_schedule=(self.prior_start,
                                                     self.prior_end),
                                     min_trick=0, belief=self.belief)
            self._agent_net = net

    @torch.no_grad()
    def play(self, net, device, epsilon: float, min_samples: int):
        net.eval()
        self._ensure_agent(net)
        out: list = []
        stats = {"games": 0, "hands": 0, "sets": 0, "bids": 0,
                 "mix_games": 0, "mix_wins": 0, "search_games": 0,
                 "hot_hands": 0, "hot_points": 0.0}

        while len(out) < min_samples:
            env = HotSeatGame(self.rng.randrange(1 << 30),
                              win_score=10 ** 9, lose_score=-(10 ** 9))
            buf: list = []  # (s, a, team, hand_index, bt, bm)
            while (len(env.hand_points) < self.hands_per_episode
                   and not env.done):
                seat, dtype, cands = env.decision()
                if dtype == D_BID:
                    env.apply(scripted_bid(env, cands))
                    continue
                # during a hand the engine's dealer IS this hand's taker
                hot = (env.g.dealer + self.role_offset) % 4
                if seat != hot:
                    which = (self.frozen_taker
                             if (self.frozen_taker is not None
                                 and seat == env.g.dealer)
                             else self.frozen)
                    env.apply(cands[reflex_pick(which, env, seat,
                                                dtype, cands)])
                    continue
                # ---- the hot seat ----
                if dtype == D_PLAY:
                    action = self.agent.choose(env, seat, dtype, cands)
                    j = cands.index(action)
                else:
                    # go-down intent + discards + trump: learner reflex
                    # with a small exploration floor
                    if self.rng.random() < max(epsilon, self.eps_godown):
                        j = self.rng.randrange(len(cands))
                    else:
                        j = reflex_pick(net, env, seat, dtype, cands)
                s_vec = encode_state_for(net, observe(env.g, seat),
                                         env.picks, dtype, env.g,
                                         env.trump_intent)
                a_vec = encode_action(dtype, cands[j])
                bt, bm = belief_target(env.g, seat)
                buf.append((s_vec, a_vec, team_of(seat),
                            len(env.hand_points), bt, bm))
                env.apply(cands[j])

            for s_vec, a_vec, team, hand_idx, bt, bm in buf:
                if hand_idx >= len(env.hand_points):
                    continue  # episode cut before this hand finished
                pts = env.hand_points[hand_idx][1 + team]
                target = (pts - POINT_POOL / 2) / (POINT_POOL / 2)
                out.append((s_vec, a_vec,
                            max(-1.0, min(1.0, target)), bt, bm))
            for dealer, p0, p1 in env.hand_points:
                stats["hot_hands"] += 1
                stats["hot_points"] += (p0, p1)[
                    team_of((dealer + self.role_offset) % 4)]
            stats["games"] += 1
            stats["hands"] += len(env.hand_points)
            stats["bids"] += len(env.hand_points)
            self.games_done += 1
        return out, stats


# --------------------------------------------------------------------------
# The luck-free battery: same decks every eval, hot seat on pure reflex.
# --------------------------------------------------------------------------

def eval_battery(net, role: str, frozen, hands: int = 240,
                 seed: int = 424242, frozen_taker=None) -> float:
    offset = ROLE_OFFSET[role]
    total, n, episode = 0.0, 0, 0
    while n < hands:
        ep_seed = seed + episode * 9973

        def deck_fn(i, ep_seed=ep_seed):
            deck = create_deck()
            random.Random(ep_seed * 1_000_003 + i * 7919).shuffle(deck)
            return deck

        env = HotSeatGame(ep_seed, deck_fn=deck_fn, dealer=episode % 4,
                          win_score=10 ** 9, lose_score=-(10 ** 9))
        while len(env.hand_points) < 8 and not env.done:
            seat, dtype, cands = env.decision()
            if dtype == D_BID:
                env.apply(scripted_bid(env, cands))
                continue
            hot = (env.g.dealer + offset) % 4
            which = (net if seat == hot
                     else frozen_taker if (frozen_taker is not None
                                           and seat == env.g.dealer)
                     else frozen)
            env.apply(cands[reflex_pick(which, env, seat, dtype, cands)])
        for dealer, p0, p1 in env.hand_points:
            total += (p0, p1)[team_of((dealer + offset) % 4)]
            n += 1
        episode += 1
    return total / max(1, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="hot-partner")
    ap.add_argument("--role", default="partner", choices=list(ROLE_OFFSET))
    ap.add_argument("--init-from", default="models/gen13.pt")
    ap.add_argument("--frozen", default="models/gen13.pt")
    ap.add_argument("--frozen-taker", default=None,
                    help="round-robin: a frozen improved specialist in "
                         "the taker's chair (training AND a second, "
                         "matched battery; the ruler battery stays "
                         "all-gen13 forever)")
    ap.add_argument("--belief", default=None)
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--worlds", type=int, default=8)
    ap.add_argument("--prior-start", type=float, default=12.0)
    ap.add_argument("--prior-end", type=float, default=2.0)
    ap.add_argument("--iters", type=int, default=100000)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--samples-per-iter", type=int, default=16384)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--eps", type=float, default=0.03)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--eval-hands", type=int, default=240)
    ap.add_argument("--hands-per-episode", type=int, default=12)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "log.jsonl"
    torch.manual_seed(args.seed)

    net = load_qnet(args.init_from)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    start_iter = 0
    best_pts = -1.0
    latest = run_dir / "latest.pt"
    if args.resume and latest.exists():
        ck = torch.load(latest, map_location="cpu", weights_only=True)
        net.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        start_iter = ck["iter"] + 1
        best_pts = ck.get("best_pts", -1.0)
        print(f"resumed {args.run} at iter {start_iter}")

    frozen = load_qnet(args.frozen)
    hot_cfg = dict(role=args.role, frozen_ckpt=args.frozen,
                   frozen_taker_ckpt=args.frozen_taker,
                   hands_per_episode=args.hands_per_episode,
                   worlds=args.worlds, prior_start=args.prior_start,
                   prior_end=args.prior_end, belief_ckpt=args.belief,
                   belief_temp=args.belief_temp)
    from .workers import WorkerPool
    pool = WorkerPool(args.workers, 32, seed=args.seed * 7919 + start_iter,
                      opponent_mix=0.0, opponent_style="basic", bid_eps=0.0,
                      script_dtypes=frozenset(), hotseat_cfg=hot_cfg)
    print(f"HOT SEAT '{args.role}' across {args.workers} workers — "
          f"search K{args.worlds} all tricks, prior {args.prior_start:g}->"
          f"{args.prior_end:g} by trick, belief {args.belief}")

    def log(rec):
        rec["ts"] = time.time()
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")

    pool.request(net, args.eps, args.samples_per_iter)
    for it in range(start_iter, args.iters):
        t0 = time.time()
        S_np, A_np, Y_np, _, _, stats = pool.gather()
        games_done = pool.games_done
        if it + 1 < args.iters:
            pool.request(net, args.eps, args.samples_per_iter)

        S = torch.from_numpy(S_np)
        A = torch.from_numpy(A_np)
        Y = torch.from_numpy(Y_np)
        net.train()
        n = len(Y_np)
        losses = []
        for _ in range(args.epochs):
            perm = torch.randperm(n)
            for i in range(0, n, args.batch_size):
                idx = perm[i:i + args.batch_size]
                loss = torch.nn.functional.mse_loss(net(S[idx], A[idx]), Y[idx])
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                opt.step()
                losses.append(loss.item())
        net.eval()

        pts = stats["hot_points"] / max(1, stats["hot_hands"])
        rec = {"iter": it, "loss": round(float(np.mean(losses)), 5),
               "samples": n, "hands": stats["hands"],
               "hot_pts": round(pts, 2),
               "sec_total": round(time.time() - t0, 1),
               "games_total": games_done}
        print(f"[{args.run} it {it}] loss {rec['loss']:.4f} "
              f"hot_pts {pts:.2f}/hand over {stats['hot_hands']} hands "
              f"{rec['sec_total']}s")
        log(rec)

        if it % args.eval_every == 0 or it == args.iters - 1:
            r = eval_battery(net, args.role, frozen, hands=args.eval_hands)
            rec2 = {"kind": "battery", "iter": it, "reflex_pts": round(r, 2)}
            if args.frozen_taker:
                ft = load_qnet(args.frozen_taker)
                m = eval_battery(net, args.role, frozen,
                                 hands=args.eval_hands, frozen_taker=ft)
                rec2["matched_pts"] = round(m, 2)
            log(rec2)
            print(f"  BATTERY (ruler): {r:.2f} pts/hand"
                  + (f"  (matched: {rec2['matched_pts']:.2f})"
                     if args.frozen_taker else ""))
            torch.save({"model": net.state_dict(), "opt": opt.state_dict(),
                        "iter": it, "best_pts": best_pts}, latest)
            if r > best_pts:
                best_pts = r
                torch.save({"model": net.state_dict(), "iter": it,
                            "reflex_pts": r}, run_dir / "best_battery.pt")
                print("  new best battery — banked")

    pool.close()
    print("done.")


if __name__ == "__main__":
    main()
