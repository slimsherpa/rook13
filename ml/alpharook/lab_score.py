"""Laboratory replay scorer — human judgment priced in points per hand.

Three arms, all paired counterfactual hand replays: take a real corpus
position, branch the one decision under test, play the hand out both ways
with the SAME frozen anytime core on every seat, and bank the hand-score
difference. Only divergent hands are played (the bidmarg lesson — identical
branches are zero by construction and cost nothing).

  riley-widow : Riley's 168 graded burials vs RC1's, from widow_picks.jsonl
  dominance   : RC1's burial vs the dominance-filtered version (never keep
                the strictly-lower same-suit non-counter — the bug Riley's
                grading found seven times over)
  convention  : partner-contract opening leads — RC1's lead vs the family
                rule "lead your highest off-trump boss 14" (only hands
                holding one; Riley's ★ data: 66% of his top picks are 14s,
                RC1 leads them 10% of the time)

    ~/torch-env/bin/python -m alpharook.lab_score dominance \
        --n 300 --workers 8 --out runs/lab/score_dominance.jsonl
"""

from __future__ import annotations

import argparse
import glob
import json
import random

import torch

from rook.cards import CARD_POINTS, team_of
from rook.engine import WIDOW
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_BID, D_DISCARD, D_PLAY, D_TRUMP
from .env import SelfPlayGame
from .model import load_qnet
from .search import _Sim
from .widowtwin import make_core


def play_out(g, core):
    sim = _Sim(g, [], None)
    while not sim.hand_over:
        s, dt, cs = sim.decision()
        sim.apply(cs[0] if len(cs) == 1 else core(sim, s, dt, cs))
    return sim.g.hand_history[-1]


def dominance_filter(godown, hand13, trump):
    """Bury-the-lower: if a buried non-counter has a kept same-suit lower
    non-counter, swap them. Provably never worse (identical go-down pts,
    strictly better kept hand). Iterate to fixed point."""
    buried = set(godown)
    kept = [c for c in hand13 if c not in buried]
    changed = True
    while changed:
        changed = False
        for b in sorted(buried, key=lambda c: -(c % 10)):
            if CARD_POINTS[b]:
                continue
            same = [k for k in kept
                    if k // 10 == b // 10 and k < b and not CARD_POINTS[k]]
            if same:
                k = min(same)
                buried.remove(b); buried.add(k)
                kept.remove(k); kept.append(b)
                changed = True
                break
    return sorted(buried)


def convention_lead(cards, trump):
    """Highest off-trump 14; tiebreak by longest suit."""
    bosses = [c for c in cards if c % 10 + 5 == 14 and c // 10 != trump]
    if not bosses:
        return None
    suit_len = {s: sum(1 for c in cards if c // 10 == s) for s in range(4)}
    return max(bosses, key=lambda c: suit_len[c // 10])


def replay_to_widow(rec, hand_no):
    """Env stepped to just before the widow buyer's D_TRUMP intent of the
    target hand. Returns (env, remaining recorded decisions iterator)."""
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    for i, (seat, dtype, action, *_r) in enumerate(rec["d"]):
        e_seat, e_dtype, cands = env.decision()
        if e_seat != seat or e_dtype != dtype:
            return None, None
        g = env.g
        if (dtype == D_TRUMP and g.phase == WIDOW
                and g.hand_number == hand_no and env.trump_intent is None):
            return env, rec["d"][i:]
        env.apply(action)
    return None, None


def widow_arms(env_seed_rec, hand_no, arms, cores):
    """arms: list of (tag, trump, godown). Each arm played once per core
    (different decision seeds) and averaged — kills playout-path noise."""
    out = {}
    for tag, tr, gd in arms:
        vals = []
        for core in cores:
            env, _rest = replay_to_widow(env_seed_rec, hand_no)
            if env is None:
                return None
            g = env.g
            b = g.bid_winner
            with torch.no_grad():
                env.apply(tr)
                for c in gd:
                    s2, d2, cands = env.decision()
                    if d2 != D_DISCARD or c not in cands:
                        return None
                    env.apply(c)
                h = play_out(g, core)
            vals.append(int(h[4] if b % 2 == 0 else h[5]))
        out[tag] = sum(vals) / len(vals)
    return out


def lead_arms(rec, hand_no, seat, arms, cores):
    """arms: list of (tag, lead_card); rep-averaged over cores."""
    out = {}
    for tag, lead in arms:
        vals = []
        for core in cores:
            env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                               dealer=rec["seed"] % 4,
                               win_score=rec.get("win", 500),
                               lose_score=rec.get("lose", -250))
            ok = False
            with torch.no_grad():
                for (s0, dt, action, *_r) in rec["d"]:
                    e_seat, e_dtype, cands = env.decision()
                    if e_seat != s0 or e_dtype != dt:
                        break
                    g = env.g
                    if (dt == D_PLAY and g.hand_number == hand_no and s0 == seat
                            and not g.completed_tricks and not g.trick_plays):
                        if lead not in cands:
                            return None
                        env.apply(lead)
                        h = play_out(g, core)
                        vals.append(int(h[4] if seat % 2 == 0 else h[5]))
                        ok = True
                        break
                    env.apply(action)
            if not ok:
                return None
        out[tag] = sum(vals) / len(vals)
    return out


def corpus_index():
    idx = {}
    for p in glob.glob("runs/belief/soak_box*_acts.jsonl"):
        for line in open(p):
            r = json.loads(line)
            if r.get("flip", 0) == 0 and r["seed"] not in idx:
                idx[r["seed"]] = r
    return idx


def build_tasks(mode, n, rng):
    idx = corpus_index()
    tasks = []
    if mode == "riley-widow":
        for line in open("runs/lab/widow_picks.jsonl"):
            r = json.loads(line)
            rec = idx.get(r["seed"])
            if rec is None:
                continue
            same = (r["human"]["trump"] == r["rc1"]["trump"]
                    and sorted(r["human"]["godown"]) == sorted(r["rc1"]["godown"]))
            tasks.append(dict(kind="widow", seed=r["seed"], hand=r["hand"],
                              same=same, grade=r.get("grade"),
                              a=("rc1", r["rc1"]["trump"], sorted(r["rc1"]["godown"])),
                              b=("riley", r["human"]["trump"], sorted(r["human"]["godown"]))))
    elif mode == "dominance":
        from .lab_mill import mill_widow
        items = mill_widow(sorted(glob.glob("runs/belief/soak_box*_acts.jsonl")),
                           n * 3, random.Random(7))
        for it in items:
            hand13 = it["dealt"] + it["widow"]
            filt = dominance_filter(it["rc1"]["godown"], hand13,
                                    it["rc1"]["trump"])
            same = filt == sorted(it["rc1"]["godown"])
            tasks.append(dict(kind="widow", seed=it["seed"], hand=it["hand"],
                              same=same,
                              a=("rc1", it["rc1"]["trump"], sorted(it["rc1"]["godown"])),
                              b=("filtered", it["rc1"]["trump"], filt)))
    elif mode == "convention":
        from .lab_mill import mill_firstcard
        items = mill_firstcard(sorted(glob.glob("runs/belief/soak_box*_acts.jsonl")),
                               n, random.Random(11))
        for it in items:
            if it["buyerRel"] != 2:
                continue
            conv = convention_lead(it["cards"], it["trump"])
            if conv is None:
                continue
            same = conv == it["rc1"]["card"]
            tasks.append(dict(kind="lead", seed=it["seed"], hand=it["hand"],
                              seat=it["seat"], same=same,
                              a=("rc1", it["rc1"]["card"]),
                              b=("convention", conv)))
    rng.shuffle(tasks)
    return tasks[: n * 2], idx


def _worker(t):
    wid, nw, tasks, mode, reps = t
    torch.set_num_threads(1)
    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    from .anytime import AnytimeRookAgent
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    cores = [AnytimeRookAgent(net, belief, seed=1000 + r).choose
             for r in range(reps)]
    idx = corpus_index()
    out = []
    for i, task in enumerate(tasks):
        if i % nw != wid:
            continue
        if task["same"]:
            out.append(dict(task=task, delta=0, skipped=True))
            continue
        rec = idx.get(task["seed"])
        try:
            if task["kind"] == "widow":
                res = widow_arms(rec, task["hand"],
                                 [task["a"], task["b"]], cores)
            else:
                res = lead_arms(rec, task["hand"], task["seat"],
                                [task["a"], task["b"]], cores)
        except Exception as e:
            res = None
        if res is None:
            continue
        ta, tb = task["a"][0], task["b"][0]
        out.append(dict(task=task, a_pts=res[ta], b_pts=res[tb],
                        delta=res[tb] - res[ta], skipped=False))
        if wid == 0 and len(out) % 5 == 0:
            print(f"  [w0] {len(out)} scored", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["riley-widow", "dominance", "convention"])
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--reps", type=int, default=3,
                    help="playouts per arm (different core seeds), averaged")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rng = random.Random(3)
    tasks, _ = build_tasks(args.mode, args.n, rng)
    n_div = sum(1 for t in tasks if not t["same"])
    print(f"{args.mode}: {len(tasks)} tasks, {n_div} divergent (played), "
          f"{len(tasks) - n_div} identical (free zeros)")
    import multiprocessing as mp
    jobs = [(w, args.workers, tasks, args.mode, args.reps)
            for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(_worker, jobs)
    rows = [r for chunk in results for r in chunk]
    import os
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    played = [r for r in rows if not r["skipped"]]
    deltas = [r["delta"] for r in rows]          # zeros included: honest
    import statistics as st
    if len(deltas) > 1:
        m = st.mean(deltas)
        se = st.stdev(deltas) / len(deltas) ** 0.5
        print(f"\n{args.mode}: {len(rows)} hands ({len(played)} played) | "
              f"B-vs-A {m:+.2f} ± {1.96 * se:.2f} pts/hand "
              f"(divergent-only: {st.mean([r['delta'] for r in played]) if played else 0:+.2f})")


if __name__ == "__main__":
    main()
