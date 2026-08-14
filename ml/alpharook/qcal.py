"""QCAL — fit the reflex-Q → family-points exchange rate (Gen26 battery §1).

The anytime searcher uses raw Q as a MAGNITUDE in exactly one place: the
light prior in the stopping test, `prior_scale * (q[c] - q[incumbent])`
pseudo-points (anytime.py). prior_scale=120 was tuned for gen21, whose Q
was trained to mean points. Gen26 was trained to match picks — its Q
ranks correctly but its scale is arbitrary. This instrument measures the
true exchange rate for BOTH nets on the same positions against the same
solved worlds, so gen21's fitted slope doubles as the sanity control
(it should land near the shipped 120).

Method, per sampled play decision (corpus replay, exactly like R1):
  1. qmaps for gen21 and gen26 over all legal candidates
  2. union of the two top-CAND_CAP shortlists (<= 12 cards)
  3. k shared belief-sampled worlds, every union card exact-solved in
     every world (CRN — deal luck cancels in every gap)
  4. bank per-candidate (q_gap, v_gap) pairs per net, v from the shared
     world means, gaps taken against that net's own incumbent

Report (from the banked rows, re-printable with --report-only):
  * through-origin slope v_gap = scale * q_gap, pooled + per-trick,
    with R^2 — the fitted prior_scale per net
  * top1 agreement (argmax Q == argmax world-mean) — rank health
  * median top-2 Q gap per net — drives both ship numbers:
    prior_scale_gen26 = 120 * med_gap(gen21) / med_gap(gen26) (preserve
    the R3 prior's effective magnitude, NOT the fitted slope — gen21's
    honest slope is ~1.5 pts/Q, so 120 was always a deliberate thumb),
    and Trainer TEMP_gen26 = med_gap(gen26) (median decision ~2.7x odds,
    the same dial feel advice.ts documents for TEMP=0.1)

    ~/torch-env/bin/python -m alpharook.qcal \
        --corpus "runs/gen26/mine_box*_v21.jsonl" --games 8 \
        --out runs/qcal/qcal.jsonl --workers 10
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random

import torch

from rook.cards import team_of
from .anytime import AnytimeRookAgent, CAND_CAP, observe
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .model import load_qnet


def measure_decision(agA, agB, env, seat, cands, k_worlds: int):
    """One calibration row: both nets' Q over the legal cands, shared
    world means over the union shortlist. None when too few worlds land."""
    g0 = env.g
    o = observe(g0, seat)
    probs = None
    if agA.belief is not None:
        try:
            probs = agA.belief.posterior(env, seat, o, D_PLAY, cands)
        except Exception:
            probs = None
    my_team = team_of(seat)
    bid_team = team_of(g0.bid_winner)
    bid = g0.high_bid
    _, qA = agA._reflex_q(env, seat, D_PLAY, list(cands))
    _, qB = agB._reflex_q(env, seat, D_PLAY, list(cands))
    shortA = sorted(cands, key=lambda c: qA[c], reverse=True)[:CAND_CAP]
    shortB = sorted(cands, key=lambda c: qB[c], reverse=True)[:CAND_CAP]
    union = sorted(set(shortA) | set(shortB))
    rng = random.Random(hash((g0.hand_number, seat,
                              len(g0.completed_tricks),
                              tuple(g0.trick_plays))) & 0x7FFFFFFF)

    sel = {c: [] for c in union}
    k = 0
    attempts = 0
    while k < k_worlds and attempts < k_worlds * 3:
        attempts += 1
        wv = agA._world_values(o, g0, union, rng, probs,
                               bid_team, bid, my_team)
        if wv is None:
            continue
        for c in union:
            sel[c].append(wv[c])
        k += 1
    if k < max(8, k_worlds // 4):
        return None
    means = {c: sum(v) / k for c, v in sel.items()}

    def net_side(qmap, short):
        inc = max(short, key=lambda c: qmap[c])
        return dict(
            inc=int(inc),
            # (q_gap, v_gap) per non-incumbent shortlist card — exactly
            # the quantity the prior scales
            pairs=[[round(qmap[c] - qmap[inc], 5),
                    round(means[c] - means[inc], 3)]
                   for c in short if c != inc],
            top1=int(inc == max(short, key=lambda c: means[c])),
            gap2=round(qmap[inc]
                       - max(qmap[c] for c in short if c != inc), 5)
            if len(short) > 1 else None)

    return dict(
        hn=g0.hand_number, seat=seat, trick=len(g0.completed_tricks),
        lead=int(len(g0.trick_plays) == 0),
        declarer=int(bid_team == my_team),
        n_cands=len(cands), k=k,
        a=net_side(qA, shortA), b=net_side(qB, shortB))


def replay_game(rec, agA, agB, k_worlds, max_trick, sample_p, rng):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    rows = []
    with torch.no_grad():
        for (seat, dtype, action, reflex, searched, is_side0) in rec["d"]:
            e_seat, e_dtype, cands = env.decision()
            assert e_seat == seat and e_dtype == dtype, \
                f"replay drift: {e_seat},{e_dtype} vs {seat},{dtype}"
            if (dtype == D_PLAY and len(cands) >= 2
                    and len(env.g.completed_tricks) <= max_trick
                    and rng.random() < sample_p):
                row = measure_decision(agA, agB, env, seat, cands, k_worlds)
                if row is not None:
                    row["seed"] = rec["seed"]
                    rows.append(row)
            env.apply(action)
        hands_seen = env.g.hand_number
    return rows, hands_seen


def _run_shard(args_tuple):
    (paths, worker_id, n_workers, out, net_a, net_b, belief_path,
     belief_temp, k_worlds, max_trick, sample_p, max_games) = args_tuple
    nA = load_qnet(net_a)
    nB = load_qnet(net_b)
    belief = BeliefOracle(belief_path, temp=belief_temp)
    agA = AnytimeRookAgent(nA, belief)
    agB = AnytimeRookAgent(nB, belief)
    rng = random.Random(0x9CA1 ^ worker_id)
    done = 0
    hands_total = 0
    path_out = out.replace(".jsonl", f"_w{worker_id}.jsonl")
    f = open(path_out, "a")
    for pi, path in enumerate(paths):
        for gi, line in enumerate(open(path)):
            if (pi * 100_003 + gi) % n_workers != worker_id:
                continue
            if done >= max_games:
                break
            rec = json.loads(line)
            try:
                rows, hands = replay_game(rec, agA, agB, k_worlds,
                                          max_trick, sample_p, rng)
            except AssertionError as e:
                print(f"  [w{worker_id}] skip seed {rec.get('seed')}: {e}",
                      flush=True)
                continue
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            done += 1
            hands_total += hands
            if worker_id == 0 and done % 2 == 0:
                print(f"  [w0] {done} games, {len(rows)} rows last game",
                      flush=True)
    f.close()
    return done, hands_total


def _fit(pairs):
    """Through-origin least squares v = s*q. Returns (slope, r2, n)."""
    sqq = sum(q * q for q, _ in pairs)
    sqv = sum(q * v for q, v in pairs)
    if sqq <= 0:
        return 0.0, 0.0, len(pairs)
    s = sqv / sqq
    svv = sum(v * v for _, v in pairs)
    resid = sum((v - s * q) ** 2 for q, v in pairs)
    r2 = 1.0 - resid / svv if svv > 0 else 0.0
    return s, r2, len(pairs)


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def report(rows):
    print(f"\nQCAL — {len(rows)} decisions "
          f"({sum(1 for r in rows if r['lead'])} leads), "
          f"tricks 0-{max(r['trick'] for r in rows)}")
    med_gap = {}
    for side, name in (("a", "gen21"), ("b", "gen26")):
        pooled = [p for r in rows for p in r[side]["pairs"]]
        s, r2, n = _fit(pooled)
        top1 = sum(r[side]["top1"] for r in rows) / len(rows)
        gaps = [r[side]["gap2"] for r in rows if r[side]["gap2"] is not None]
        med_gap[side] = _median(gaps) if gaps else float("nan")
        print(f"\n  {name}: fitted prior_scale {s:.1f} pts/Q "
              f"(R2 {r2:.3f}, {n} gap pairs) | "
              f"top1 Q==worlds {100 * top1:.1f}% | "
              f"median top-2 Q gap {med_gap[side]:.4f}")
        for t in sorted({r["trick"] for r in rows}):
            sub = [p for r in rows if r["trick"] == t
                   for p in r[side]["pairs"]]
            if len(sub) < 30:
                continue
            st, rt, nt = _fit(sub)
            print(f"    trick {t}: scale {st:.1f} (R2 {rt:.3f}, n={nt})")
    if med_gap.get("a") and med_gap.get("b"):
        # prior_scale=120 was never a fitted exchange rate (gen21's true
        # slope is ~1.5 pts/Q) — it is a deliberately heavy prior, tuned
        # so lopsided decisions exit early (R3). Porting it to gen26
        # means preserving the EFFECTIVE pseudo-point magnitudes, i.e.
        # scaling by the ratio of typical Q gaps — not using the slope.
        ps = 120.0 * med_gap["a"] / med_gap["b"]
        print(f"\n  suggested prior_scale for gen26: {ps:.0f} "
              f"(= 120 * gap21/gap26 — preserves the R3 prior weight)")
        # Trainer TEMP, scale-free: TEMP = the net's own median top-2
        # gap puts the MEDIAN decision at gap/TEMP = 1 (~2.7x odds),
        # exactly the design point advice.ts documents for TEMP=0.1.
        print(f"  suggested Trainer TEMP for gen26: {med_gap['b']:.3f} "
              f"(median decision reads ~2.7x odds, matching the "
              f"current dial feel)")
    print("\n  fitted slopes above are the HONEST pts/Q exchange rates "
          "(R2 = how much of the value gap Q explains — a rank-health "
          "diagnostic, not the ship number)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="runs/gen26/mine_box*_v21.jsonl")
    ap.add_argument("--net-a", default="models/gen21-cand1.pt",
                    help="control net (Q trained in points)")
    ap.add_argument("--net-b", default="runs/gen26v0b/best.pt",
                    help="candidate net (Q scale unknown)")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--k", type=int, default=48,
                    help="shared worlds per decision")
    ap.add_argument("--max-trick", type=int, default=4)
    ap.add_argument("--sample-p", type=float, default=0.5)
    ap.add_argument("--games", type=int, default=8, help="games per worker")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--out", default="runs/qcal/qcal.jsonl")
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()

    if not args.report_only:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        paths = sorted(glob.glob(args.corpus))
        assert paths, f"no corpus at {args.corpus}"
        import multiprocessing as mp
        jobs = [(paths, w, args.workers, args.out, args.net_a, args.net_b,
                 args.belief, args.belief_temp, args.k, args.max_trick,
                 args.sample_p, args.games) for w in range(args.workers)]
        with mp.get_context("spawn").Pool(args.workers) as pool:
            results = pool.map(_run_shard, jobs)
        print(f"measured {sum(r[0] for r in results)} games")

    rows = []
    # pools every worker shard sharing the out prefix — including fleet
    # pulls (qcal_boxN_w*.jsonl next to the laptop's qcal_w*.jsonl)
    for p in sorted(glob.glob(args.out.replace(".jsonl", "*_w*.jsonl"))):
        rows += [json.loads(l) for l in open(p)]
    if not rows:
        print("no rows measured")
        return
    report(rows)


if __name__ == "__main__":
    main()
