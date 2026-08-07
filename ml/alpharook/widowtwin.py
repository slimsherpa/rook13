"""P1.3 gate instrument — twin contracts: same deal, only the burial
differs, points per contract.

For every widow decision in generated games: the incumbent burial is
what production plays today (reflex intent + greedy picks); the
challenger is MortalWidow's confirmed choice. When they AGREE the
contract costs nothing and is logged as agreement (their rate is itself
a finding). When they DIFFER, the hand is played out TWICE from the
burial — identical deal, identical auction, identical play core for all
four seats — and the row records the declarer-team hand-score swing.
Deal luck cancels inside the twin; even +5 is real.

The play core is a parameter because the gate's verdict only counts
under P1.2's frozen core: --core reflex (fast shakeout), --core cosmo
(gen21 x belief x t0 — production today), --core anytime (the P1.1
searcher — the presumptive new core).

    ~/torch-env/bin/python -m alpharook.widowtwin --minutes 30 --workers 8 \
        --core anytime --out runs/p13/twins

Shards: <out>/<tag>_wN.jsonl, one line per contract.
"""

from __future__ import annotations

import argparse
import json
import os
import time

import torch

from rook.cards import team_of
from rook.engine import WIDOW, HAND_DONE, GAME_OVER
from .arena import model_choose
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_TRUMP, D_PLAY
from .env import SelfPlayGame
from .model import load_qnet
from .mortalwidow import MortalWidowAgent


def make_core(name: str, net, belief):
    """The card player that finishes both twins. Returns choose(env,
    seat, dtype, cands)."""
    if name == "reflex":
        return lambda env, seat, dtype, cands: model_choose(
            net, "cpu", env, seat, dtype, cands)
    if name == "cosmo":
        from .search import SearchAgent
        ag = SearchAgent(net, worlds=24, prior_weight=2.0, min_trick=0,
                         belief=belief, search_dtypes=frozenset({D_PLAY}))
        return ag.choose
    if name == "anytime":
        from .anytime import AnytimeRookAgent
        ag = AnytimeRookAgent(net, belief)
        return ag.choose
    raise ValueError(f"unknown core {name}")


def twin(env, seat, disc, trump, core):
    """Clone the widow-decision state, apply one burial, play the hand
    out with the core making every decision (search.py's _Sim stops at
    the end of the CURRENT hand instead of dealing the next). Returns
    (hand_score_team0, hand_score_team1)."""
    from .search import _Sim
    g = env.g.clone()
    g.select_go_down(seat, list(disc))
    g.select_trump(seat, trump)
    sim = _Sim(g, [], None)
    while not sim.hand_over:
        s, dt, cs = sim.decision()
        pick = cs[0] if len(cs) == 1 else core(sim, s, dt, cs)
        sim.apply(pick)
    h = g.hand_history[-1]
    return int(h[4]), int(h[5])


def worker(worker_id: int, args, run_tag: str):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    belief = BeliefOracle(args.belief, temp=args.belief_temp)
    proposer = None
    if args.proposer:
        from .widowprop import WidowProp
        ck = torch.load(args.proposer, weights_only=False)
        proposer = WidowProp(ck["d_state"])
        proposer.load_state_dict(ck["state_dict"])
        proposer.eval()
    mw = MortalWidowAgent(net, belief, budget_s=args.widow_budget,
                          k_min=args.k_min,
                          proposer=proposer, seed=worker_id)
    core = make_core(args.core, net, belief)
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{run_tag}_w{worker_id}.jsonl")
    f = open(path, "a")
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    parent = os.getppid()
    n = 0
    while time.time() < t_end:
        if os.getppid() != parent:
            return
        seed += 1
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        with torch.no_grad():
            while not env.done and time.time() < t_end:
                seat, dtype, cands = env.decision()
                if dtype == D_TRUMP and env.g.phase == WIDOW \
                        and env.trump_intent is None:
                    # the contract point: price both burials
                    incumbent = mw._greedy_reflex_burial(
                        env, seat, model_choose(net, "cpu", env, seat,
                                                D_TRUMP, cands))
                    choice = mw._widow_search(env, seat)
                    row = dict(seed=seed, hn=env.g.hand_number,
                               declarer=seat, bid=int(env.g.high_bid),
                               inc=[list(incumbent[0]), incumbent[1]],
                               mw=[list(choice[0]), choice[1]],
                               agree=int(choice == incumbent),
                               k=mw.last_widow["k"],
                               stop=mw.last_widow["stop"],
                               confirmed=mw.last_widow["confirmed"])
                    if args.label_rows:
                        # self-contained proposer training row: the
                        # leak-tested full-view state + the valued menu
                        from rook.observation import observe
                        from .encoder import encode_state_for
                        s = encode_state_for(net, observe(env.g, seat),
                                             env.picks, D_TRUMP, env.g,
                                             env.trump_intent)
                        row.update(
                            hand13=sorted(env.g.hands[seat]),
                            dealer=env.g.dealer,
                            scores=[int(x) for x in env.g.scores],
                            state=[round(float(x), 4) for x in s],
                            cand_means=mw.last_widow["cand_means"])
                    if choice != incumbent:
                        dteam = team_of(seat)
                        a0, a1 = twin(env, seat, *incumbent, core)
                        b0, b1 = twin(env, seat, *choice, core)
                        inc_d = (a0 - a1) if dteam == 0 else (a1 - a0)
                        mw_d = (b0 - b1) if dteam == 0 else (b1 - b0)
                        row.update(inc_diff=inc_d, mw_diff=mw_d,
                                   gain=mw_d - inc_d)
                    f.write(json.dumps(row) + "\n")
                    f.flush()
                    n += 1
                    if worker_id == 0 and n % 5 == 0:
                        print(f"  [w0] {n} contracts, "
                              f"{(t_end - time.time()) / 60:.0f} min left",
                              flush=True)
                    # the real game continues with the INCUMBENT burial:
                    # contract generation stays production-distributed
                    env.apply(incumbent[1])
                    for c in incumbent[0]:
                        env.apply(c)
                    continue
                pick = model_choose(net, "cpu", env, seat, dtype, cands)
                env.apply(pick)
    f.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--core", default="reflex",
                    choices=["reflex", "cosmo", "anytime"])
    ap.add_argument("--widow-budget", type=float, default=60.0)
    ap.add_argument("--k-min", type=int, default=8,
                    help="selection floor: a challenger is only crowned "
                         "on at least this many worlds (the card-play "
                         "floors-are-load-bearing lesson)")
    ap.add_argument("--proposer", default=None,
                    help="WidowProp checkpoint: cut the shortlist to its "
                         "top-4 (+incumbent) before pricing")
    ap.add_argument("--label-rows", action="store_true",
                    help="write self-contained proposer training rows "
                         "(encoder state + per-candidate world-mean "
                         "values) — the AlphaZero label stream")
    ap.add_argument("--out", default="runs/p13/twins")
    ap.add_argument("--seed-base", type=int, default=13_000_000_000)
    ap.add_argument("--run-tag", default=None)
    args = ap.parse_args()
    run_tag = args.run_tag or f"{args.core}"
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"widow twins: {args.workers} workers, {args.minutes} min, "
          f"core={args.core} -> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("WIDOWTWIN RUN DONE", flush=True)


if __name__ == "__main__":
    main()
