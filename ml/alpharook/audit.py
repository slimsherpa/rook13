"""gen14: the replay & blunder engine.

Riley's idea, formalized: freeze a finished deal and retry it — same
cards, same auction, every alternative — until you know whether a better
line existed. Two verdicts per decision:

  HINDSIGHT: in the TRUE world (we know every hidden card in self-play),
    play each legal alternative from this exact position and let the
    champion reflex finish the hand for all four seats. The gap between
    the best alternative's outcome and the played line's outcome is what
    this decision actually cost.

  KNOWABILITY: hindsight alone is unfair — a play that's right on average
    can lose in this particular world. So a costly decision only counts
    as a PREVENTABLE BLUNDER if a deep search from the player's own
    observation (imagined worlds, no peeking) ALSO prefers the better
    card. Costly + knowable = blunder; costly + unknowable = bad luck.

Outputs a JSONL of blunders (position, played, better, cost, verdicts)
ready to become training targets, plus per-hand rates — the number the
family currently estimates by feel.

    python -m alpharook.audit --ckpt models/gen13.pt --games 100 --workers 7
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from rook.cards import team_of
from rook.engine import Game, PLAYING, HAND_DONE, GAME_OVER
from rook.observation import observe
from .encoder import encode_state_for, encode_action, D_PLAY
from .env import SelfPlayGame
from .model import load_qnet
from .search import SearchAgent, _Sim, rollout_value

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"

# a decision is COSTLY when the best alternative beats the played line by
# this many hand points in the true world (a counter trick is 20-25)
COST_THRESHOLD = 25.0
# ...and KNOWABLE when deep search's blended score prefers the alternative
# by more than its noise floor
KNOW_THRESHOLD = 0.02


def clone_game(g: Game) -> Game:
    return g.clone()  # moved onto Game for gen16's fork tree; alias kept


@torch.no_grad()
def reflex_playout(g: Game, net, device: str = "cpu") -> float:
    """Finish the hand with the champion reflex at all four seats; returns
    the hand-score diff for team 0 (true-world counterfactual value).
    Mutates g to the finished state (callers may also score it with
    rollout_value for target-scale labels)."""
    sim = _Sim(g, [], None)
    while not sim.hand_over:
        seat, dtype, cands = sim.decision()
        if len(cands) == 1:
            sim.apply(cands[0])
            continue
        s = encode_state_for(net, observe(sim.g, seat), sim.picks, dtype,
                             sim.g, sim.trump_intent)
        S = torch.from_numpy(np.stack([s] * len(cands))).to(device)
        A = torch.from_numpy(
            np.stack([encode_action(dtype, c) for c in cands])).to(device)
        q = net(S, A).cpu().numpy()
        sim.apply(cands[int(np.argmax(q))])
    h = sim.g.hand_history[-1]
    return float(h[4] - h[5])


@torch.no_grad()
def audit_game(net, oracle: SearchAgent, seed: int, device: str = "cpu",
               audit_seats: tuple = (0, 1, 2, 3), dump: list | None = None):
    """Play one self-play game (champion reflex, all seats) and audit every
    multi-choice CARD decision of the audited seats. Returns (blunders,
    stats). With `dump` a list, also collects hindsight training rows:
    (state, action, target, weight, decision_index) tuples — every
    candidate labeled by its true-world counterfactual playout on the
    net's own target scale, preventable-blunder decisions upweighted, and
    low-weight anchor rows (the net's own q) for unaudited decisions so
    bidding/go-down can't drift (the gen12 lesson)."""
    env = SelfPlayGame(seed)
    blunders: list[dict] = []
    stats = {"hands": 0, "decisions": 0, "costly": 0, "preventable": 0,
             "cost_sum": 0.0}
    last_hand = 0

    while not env.done:
        seat, dtype, cands = env.decision()
        # the champion's actual choice (reflex, exactly how it plays live)
        s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                             env.g, env.trump_intent)
        S = torch.from_numpy(np.stack([s] * len(cands))).to(device)
        A = torch.from_numpy(
            np.stack([encode_action(dtype, c) for c in cands])).to(device)
        q = net(S, A).cpu().numpy()
        played = cands[int(np.argmax(q))]

        audited = (dtype == D_PLAY and len(cands) > 1 and seat in audit_seats
                   and env.g.phase == PLAYING)
        if dump is not None and not audited and len(cands) > 1:
            # anchor row: keep unaudited decision types where they are
            dump.append((s, [(encode_action(dtype, c), float(q[i]))
                             for i, c in enumerate(cands)], 0.25))
        if audited:
            stats["decisions"] += 1
            # HINDSIGHT: counterfactual value of every candidate in the
            # true world, identical continuation policy
            my_team = team_of(seat)
            sign = 1.0 if my_team == 0 else -1.0
            values = {}
            targets = {}
            for c in cands:
                g2 = clone_game(env.g)
                g2.play_card(seat, c)
                if g2.phase not in (HAND_DONE, GAME_OVER):
                    reflex_playout(g2, net, device)
                h = g2.hand_history[-1]
                values[c] = sign * float(h[4] - h[5])
                targets[c] = rollout_value(g2, my_team)
            best = max(values, key=values.get)
            cost = values[best] - values[played]

            knowable = False
            if cost >= COST_THRESHOLD:
                stats["costly"] += 1
                # KNOWABILITY: does honest search (no peeking) agree?
                oracle.choose(env, seat, dtype, list(cands))
                tap = oracle.last_search
                s_gap = 0.0
                if tap is not None:
                    _, _, t_cands, t_scores = tap
                    sc = dict(zip(t_cands, t_scores))
                    if best in sc and played in sc:
                        s_gap = sc[best] - sc[played]
                        knowable = s_gap > KNOW_THRESHOLD
                if knowable:
                    stats["preventable"] += 1
                    stats["cost_sum"] += cost
                blunders.append({
                    "seed": seed, "hand": env.g.hand_number,
                    "trick": len(env.g.completed_tricks) + 1,
                    "seat": seat, "played": played, "best": int(best),
                    "cost": round(cost, 1),
                    "search_gap": round(float(s_gap), 4),
                    "preventable": knowable,
                })
            if dump is not None:
                # preventable-blunder decisions carry 4x the gradient
                dump.append((s, [(encode_action(dtype, c), targets[c])
                                 for c in cands], 4.0 if knowable else 1.0))

        env.apply(played)
        if len(env.g.hand_history) != last_hand:
            last_hand = len(env.g.hand_history)
            stats["hands"] += 1
    return blunders, stats


# --- multiprocess plumbing --------------------------------------------------

_W: dict = {}


def _init(ckpt: str, worlds: int, min_trick: int, dump: bool = False):
    torch.set_num_threads(1)
    _W["net"] = load_qnet(ckpt)
    _W["dump"] = dump
    _W["oracle"] = SearchAgent(_W["net"], worlds=worlds,
                               search_dtypes=frozenset({D_PLAY}),
                               prior_weight=2.0, min_trick=min_trick, seed=17)


def _one(seed: int):
    rows: list | None = [] if _W["dump"] else None
    blunders, stats = audit_game(_W["net"], _W["oracle"], seed, dump=rows)
    return blunders, stats, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="models/gen13.pt")
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--worlds", type=int, default=32,
                    help="oracle search width for the knowability check")
    ap.add_argument("--min-trick", type=int, default=0,
                    help="oracle searches from this trick (0 = every trick)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=None,
                    help="blunder JSONL path (default runs/audit/<ckpt>.jsonl)")
    ap.add_argument("--dump-dir", default=None,
                    help="also write hindsight training shards here "
                         "(distill.py --train consumes them)")
    args = ap.parse_args()

    name = Path(args.ckpt).stem
    out = Path(args.out) if args.out else RUNS_DIR / "audit" / f"{name}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    dump_dir = Path(args.dump_dir) if args.dump_dir else None
    if dump_dir:
        dump_dir.mkdir(parents=True, exist_ok=True)

    shard_buf = {"S": [], "A": [], "y": [], "w": [], "di": [], "n": 0}

    def absorb(rows):
        for state, cand_rows, weight in rows:
            di_val = len(shard_buf["S"])
            shard_buf["S"].append(state)
            for a_vec, target in cand_rows:
                shard_buf["A"].append(a_vec)
                shard_buf["y"].append(target)
                shard_buf["w"].append(weight)
                shard_buf["di"].append(di_val)
        if len(shard_buf["A"]) >= 100_000:
            flush_shard()

    def flush_shard():
        if not shard_buf["A"]:
            return
        from .distill import _flush
        _flush(dump_dir, 0, shard_buf["n"], shard_buf["S"], shard_buf["A"],
               shard_buf["y"], shard_buf["w"], shard_buf["di"],
               seed=args.seed)
        shard_buf["n"] += 1
        for k in ("S", "A", "y", "w", "di"):
            shard_buf[k].clear()

    seeds = [args.seed + i * 7919 + 1 for i in range(args.games)]
    t0 = time.time()
    total = {"hands": 0, "decisions": 0, "costly": 0, "preventable": 0,
             "cost_sum": 0.0}
    n_done = 0
    with open(out, "w") as f:
        if args.workers > 1:
            import multiprocessing as mp
            ctx = mp.get_context("spawn")
            with ctx.Pool(args.workers, initializer=_init,
                          initargs=(args.ckpt, args.worlds, args.min_trick,
                                    dump_dir is not None)) as pool:
                for blunders, st, rows in pool.imap_unordered(_one, seeds):
                    for b in blunders:
                        f.write(json.dumps(b) + "\n")
                    if rows and dump_dir:
                        absorb(rows)
                    for k in total:
                        total[k] += st[k]
                    n_done += 1
                    if n_done % 10 == 0:
                        h = max(1, total["hands"])
                        print(f"  [{n_done}/{args.games}] "
                              f"{total['preventable'] / h:.2f} preventable "
                              f"blunders/hand "
                              f"({(time.time() - t0) / n_done:.1f}s/game)",
                              flush=True)
        else:
            _init(args.ckpt, args.worlds, args.min_trick,
                  dump_dir is not None)
            for seed in seeds:
                blunders, st, rows = _one(seed)
                for b in blunders:
                    f.write(json.dumps(b) + "\n")
                if rows and dump_dir:
                    absorb(rows)
                for k in total:
                    total[k] += st[k]
    if dump_dir:
        flush_shard()

    h = max(1, total["hands"])
    d = max(1, total["decisions"])
    print(f"\n=== BLUNDER AUDIT: {name} over {args.games} games "
          f"({total['hands']} hands) ===")
    print(f"  card decisions audited: {total['decisions']}")
    print(f"  costly in hindsight:    {total['costly']} "
          f"({total['costly'] / d:.1%} of decisions)")
    print(f"  PREVENTABLE blunders:   {total['preventable']} "
          f"({total['preventable'] / h:.2f} per hand, avg cost "
          f"{total['cost_sum'] / max(1, total['preventable']):.0f} pts)")
    print(f"  blunder log: {out}")


if __name__ == "__main__":
    main()
