"""THE MORTAL PROBE — per-decision ceiling measurement (2026-08-02 night).

The MortalGod DUEL failed exactly as gen11's first law predicted: argmax
over a few sampled worlds favors gambit lines that only worked in the
sample (first paired read: 2-8, swept 0-3). This instrument keeps the
question — "how many points does perfect calculation win over Cosmo,
given the same imagination?" — and fixes the noise problem with three
moves ceiling.py taught us:

  1. PER-DECISION, not per-game: freeze real decisions from Cosmo-stack
     self-play (the production policy's own distribution), probe only
     tricks 0..MAX_TRICK where the map says the money is.
  2. COMMON RANDOM NUMBERS: every candidate priced in the SAME worlds.
  3. SPLIT-SAMPLE HONESTY: pick the challenger card on the SELECTION
     worlds, then price challenger-vs-Cosmo's-card on FRESH EVALUATION
     worlds. The selection maximum is winner's-curse-biased by
     construction; the evaluation difference is unbiased. `gain` is the
     number to trust; `sel_gap` is recorded only to show the bias.

Values are family hand currency (set = -bid) via mortalgod.hand_value.
Agreement rows (challenger == Cosmo's card) cost no eval solves and are
the cheapest, most common outcome — record them; their gain is 0 by
definition and they measure how often calculation even disagrees.

    ~/torch-env/bin/python -m alpharook.mortalprobe --minutes 20 --workers 8

Shards: runs/gen24/mortalprobe/<tag>_wN.jsonl (append per probe).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time

import numpy as np
import torch

from rook.cards import team_of
from rook.determinize import sample_world, sample_world_weighted
from rook.observation import observe
import os as _os
if _os.environ.get("ROOK_PURE_PY"):
    from rook import solver as S
else:
    try:
        from rook import csolver as S     # 58-66x, parity-gated
    except Exception as _e:
        print(f"[mortalprobe] WARNING: C solver unavailable ({_e}); "
              f"falling back to PYTHON solver (~60x slower)", flush=True)
        from rook import solver as S

from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY, encode_state_for, encode_action
from .env import SelfPlayGame
from .model import load_qnet
from .mortalgod import hand_value
from .search import SearchAgent, materialize

CAND_CAP = 6


def price(g, cands, kw):
    """{cand: exact family-value} in ONE materialized world."""
    hh = [list(h) for h in g.hands]
    vals = S.play_values(hh, g.trump, g.trick_leader, g.go_down_points(),
                         only=list(cands), **kw)
    for c in cands:
        if c not in vals:
            vals[c] = S.play_values(hh, g.trump, g.trick_leader,
                                    g.go_down_points(), only=[c], **kw)[c]
    return vals


def probe(env, seat, cands, chosen, belief, k_sel, k_eval, rng):
    g0 = env.g
    o = observe(g0, seat)
    try:
        probs = belief.posterior(env, seat, o, D_PLAY, cands)
    except Exception:
        probs = None

    def draw():
        try:
            if probs is not None:
                return sample_world_weighted(o, rng, probs)
            return sample_world(o, rng)
        except Exception:
            return None

    my_team = team_of(seat)
    bid_team = team_of(g0.bid_winner)
    bid = g0.high_bid

    def world_values(want):
        g = None
        w = draw()
        if w is None:
            return None
        g = materialize(o, w[0], w[1], g0.win_score, g0.lose_score)
        kw = dict(t0_tricks=g.tricks_won[0],
                  tricks_done=len(g.completed_tricks),
                  trick=tuple(g.trick_plays))
        vals = price(g, want, kw)
        return {c: hand_value(g.points_taken[0] + vals[c],
                              bid_team, bid, my_team) for c in want}

    sel = {c: [] for c in cands}
    for _ in range(k_sel):
        wv = world_values(cands)
        if wv:
            for c in cands:
                sel[c].append(wv[c])
    if not sel[cands[0]]:
        return None
    means = {c: sum(v) / len(v) for c, v in sel.items()}
    cstar = max(cands, key=lambda c: means[c])
    sel_gap = means[cstar] - means[chosen]
    if cstar == chosen:
        return dict(agree=1, gain=0.0, sel_gap=round(sel_gap, 1),
                    k_sel=len(sel[cands[0]]), k_eval=0)
    ev = {cstar: [], chosen: []}
    for _ in range(k_eval):
        wv = world_values([cstar, chosen])
        if wv:
            ev[cstar].append(wv[cstar])
            ev[chosen].append(wv[chosen])
    if not ev[cstar]:
        return None
    gain = (sum(ev[cstar]) / len(ev[cstar])
            - sum(ev[chosen]) / len(ev[chosen]))
    return dict(agree=0, gain=round(gain, 1), sel_gap=round(sel_gap, 1),
                k_sel=len(sel[cands[0]]), k_eval=len(ev[cstar]))


def worker(worker_id: int, args, run_tag: str):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    belief = BeliefOracle(args.belief, temp=args.belief_temp)
    agent = SearchAgent(net, worlds=24, prior_weight=2.0, min_trick=0,
                        belief=belief,
                        search_dtypes=frozenset({D_PLAY}), seed=worker_id)
    os.makedirs(args.out, exist_ok=True)
    rng = random.Random(args.seed_base ^ (worker_id * 104729))
    path = os.path.join(args.out, f"{run_tag}_w{worker_id}.jsonl")
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    n_probe = 0
    parent = os.getppid()
    f = open(path, "a")
    while time.time() < t_end:
        if os.getppid() != parent:
            return
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        with torch.no_grad():
            while not env.done and time.time() < t_end:
                seat, dtype, cands = env.decision()
                pick = agent.choose(env, seat, dtype, cands)
                trick = len(env.g.completed_tricks)
                if (dtype == D_PLAY and len(cands) > 1
                        and trick <= args.max_trick
                        and rng.random() < args.probe_p):
                    use = list(cands)
                    if len(use) > CAND_CAP:
                        s = encode_state_for(net, observe(env.g, seat),
                                             env.picks, dtype, env.g,
                                             env.trump_intent)
                        S_ = torch.from_numpy(np.stack([s] * len(use)))
                        A_ = torch.from_numpy(np.stack(
                            [encode_action(dtype, a) for a in use]))
                        q = net(S_, A_).numpy()
                        use = [use[int(i)] for i in np.argsort(-q)[:CAND_CAP]]
                        if pick not in use:
                            use[-1] = pick
                    r = probe(env, seat, use, pick, belief,
                              args.k_sel, args.k_eval, rng)
                    if r is not None:
                        r.update(seed=seed, hn=env.g.hand_number,
                                 trick=trick, pos=len(env.g.trick_plays),
                                 seat=seat,
                                 declarer=int(seat == env.g.bid_winner),
                                 decl_team=int(team_of(seat) == team_of(
                                     env.g.bid_winner)),
                                 bid=int(env.g.high_bid),
                                 n_cands=len(use))
                        f.write(json.dumps(r) + "\n")
                        f.flush()
                        n_probe += 1
                        if worker_id == 0 and n_probe % 10 == 0:
                            print(f"  [w0] {n_probe} probes, "
                                  f"{(t_end - time.time()) / 60:.0f} min "
                                  f"left", flush=True)
                env.apply(pick)
    f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--out", default="runs/gen24/mortalprobe")
    ap.add_argument("--seed-base", type=int, default=9_500_000_000)
    ap.add_argument("--max-trick", type=int, default=2)
    ap.add_argument("--probe-p", type=float, default=0.20)
    ap.add_argument("--k-sel", type=int, default=12)
    ap.add_argument("--k-eval", type=int, default=12)
    ap.add_argument("--run-tag", default=None)
    args = ap.parse_args()
    run_tag = args.run_tag or f"p{args.seed_base % 1_000_000:06d}"
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"mortal probe: {args.workers} workers, {args.minutes} min, "
          f"K {args.k_sel}+{args.k_eval}, tricks 0-{args.max_trick} "
          f"-> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("MORTALPROBE RUN DONE", flush=True)


if __name__ == "__main__":
    main()
