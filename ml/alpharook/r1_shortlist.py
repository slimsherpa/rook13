"""R1 `shortlist_regret` — is the top-6 menu too small? (FINAL-WEEK-PLAN §6)

At tricks 0-2, how often would the BEST LEGAL MORTAL — same bel15 worlds,
same C solver, same family-points utility, but ALL legal candidates — choose
outside Reflex's CAND_CAP=6 shortlist, and at what cost?

The measurement-side winner's-curse guard (Law 2): a raw argmax over K
worlds would manufacture phantom regret, so an outside-the-shortlist winner
must CONFIRM its gain over the shortlist's best on fresh evaluation worlds,
exactly like the live searcher's discipline (tau on eval-world means).
Unconfirmed challengers count as noise, cost zero.

The god referee (reported separately, never conflated): one exact solve of
the TRUE deal prices the oracle upper bound of the same exclusion.

Replays the belief-soak corpus (runs/belief/soak_box*_acts.jsonl): each
recorded game is re-stepped decision by decision under the recorded
win/lose rule; measurements run BEFORE the recorded action is applied, so
every state is exactly the state the fleet saw.

    ~/torch-env/bin/python -m alpharook.r1_shortlist \
        --corpus "runs/belief/soak_box1_acts.jsonl" --games 40 \
        --out runs/r1/r1_box1.jsonl --workers 14

Row per measured decision; aggregate table printed at end of each shard.
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


def measure_decision(ag, god, env, seat, cands, k_sel: int, k_eval: int,
                     tau: float):
    """Returns a result row, or None when the shortlist isn't binding."""
    if len(cands) <= CAND_CAP:
        return None
    g0 = env.g
    o = observe(g0, seat)
    probs = None
    if ag.belief is not None:
        try:
            probs = ag.belief.posterior(env, seat, o, D_PLAY, cands)
        except Exception:
            probs = None
    my_team = team_of(seat)
    bid_team = team_of(g0.bid_winner)
    bid = g0.high_bid
    _, qmap = ag._reflex_q(env, seat, D_PLAY, list(cands))
    short = sorted(cands, key=lambda c: qmap[c], reverse=True)[:CAND_CAP]
    rng = random.Random(hash((g0.hand_number, seat,
                              len(g0.completed_tricks),
                              tuple(g0.trick_plays))) & 0x7FFFFFFF)

    # SELECT: k_sel shared worlds across ALL legal candidates (CRN by
    # construction — every world prices every candidate)
    sel = {c: [] for c in cands}
    k = 0
    attempts = 0
    while k < k_sel and attempts < k_sel * 3:
        attempts += 1
        wv = ag._world_values(o, g0, list(cands), rng, probs,
                              bid_team, bid, my_team)
        if wv is None:
            continue
        for c in cands:
            sel[c].append(wv[c])
        k += 1
    if k < max(8, k_sel // 4):
        return None
    means = {c: sum(v) / k for c, v in sel.items()}
    best_all = max(cands, key=lambda c: means[c])
    best_short = max(short, key=lambda c: means[c])
    excluded_raw = best_all not in short

    conf_gain = 0.0
    confirmed = False
    if excluded_raw:
        # CONFIRM on fresh worlds (same rng stream continues)
        ev_a, ev_s = [], []
        ke = 0
        ev_attempts = 0
        while ke < k_eval and ev_attempts < k_eval * 3:
            ev_attempts += 1
            wv = ag._world_values(o, g0, [best_all, best_short], rng, probs,
                                  bid_team, bid, my_team)
            if wv is None:
                continue
            ev_a.append(wv[best_all])
            ev_s.append(wv[best_short])
            ke += 1
        if ke >= max(8, k_eval // 2):
            conf_gain = (sum(ev_a) - sum(ev_s)) / ke
            confirmed = conf_gain >= tau

    # god referee: ONE exact world — the true deal (contam_p=1 container)
    gv = god._world_values(o, g0, list(cands), random.Random(0), None,
                           bid_team, bid, my_team)
    god_gain = 0.0
    god_excluded = False
    if gv is not None:
        g_best = max(cands, key=lambda c: gv[c])
        g_short = max(short, key=lambda c: gv[c])
        god_gain = gv[g_best] - gv[g_short]
        god_excluded = g_best not in short

    return dict(
        hn=g0.hand_number, seat=seat, trick=len(g0.completed_tricks),
        lead=int(len(g0.trick_plays) == 0),
        declarer=int(bid_team == my_team),
        n_cands=len(cands), k=k,
        excluded_raw=int(excluded_raw), confirmed=int(confirmed),
        conf_gain=round(conf_gain, 3),
        god_excluded=int(god_excluded), god_gain=round(god_gain, 3))


def replay_game(rec, ag, god, k_sel, k_eval, tau, sample_p, rng):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                       dealer=rec["seed"] % 4,
                       win_score=rec.get("win", 500),
                       lose_score=rec.get("lose", -250))
    rows = []
    hands_seen = 0
    with torch.no_grad():
        for (seat, dtype, action, reflex, searched, is_side0) in rec["d"]:
            e_seat, e_dtype, cands = env.decision()
            assert e_seat == seat and e_dtype == dtype, \
                f"replay drift: {e_seat},{e_dtype} vs {seat},{dtype}"
            if (dtype == D_PLAY and searched and is_side0
                    and len(env.g.completed_tricks) < 3
                    and rng.random() < sample_p):
                row = measure_decision(ag, god, env, seat, cands,
                                       k_sel, k_eval, tau)
                if row is not None:
                    row["seed"] = rec["seed"]
                    rows.append(row)
            env.apply(action)
        hands_seen = env.g.hand_number
    return rows, hands_seen


def _run_shard(args_tuple):
    (paths, worker_id, n_workers, out, net_path, belief_path, belief_temp,
     k_sel, k_eval, tau, sample_p, max_games) = args_tuple
    net = load_qnet(net_path)
    net.eval()
    belief = BeliefOracle(belief_path, temp=belief_temp)
    ag = AnytimeRookAgent(net, belief, contam_p=0.0)
    god = AnytimeRookAgent(net, belief, contam_p=1.0)
    rng = random.Random(0xC0FFEE ^ worker_id)
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
                rows, hands = replay_game(rec, ag, god, k_sel, k_eval, tau,
                                          sample_p, rng)
            except AssertionError as e:
                print(f"  [w{worker_id}] skip seed {rec.get('seed')}: {e}",
                      flush=True)
                continue
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            done += 1
            hands_total += hands
            if worker_id == 0 and done % 5 == 0:
                print(f"  [w0] {done} games, {hands_total} hands", flush=True)
    f.close()
    return done, hands_total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="runs/belief/soak_box*_acts.jsonl")
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--belief", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--k-sel", type=int, default=96)
    ap.add_argument("--k-eval", type=int, default=24)
    ap.add_argument("--tau", type=float, default=2.0)
    ap.add_argument("--sample-p", type=float, default=1.0,
                    help="probability a qualifying decision is measured")
    ap.add_argument("--games", type=int, default=40,
                    help="games per worker")
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--out", default="runs/r1/r1.jsonl")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    paths = sorted(glob.glob(args.corpus))
    assert paths, f"no corpus at {args.corpus}"
    import multiprocessing as mp
    jobs = [(paths, w, args.workers, args.out, args.net, args.belief,
             args.belief_temp, args.k_sel, args.k_eval, args.tau,
             args.sample_p, args.games) for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(_run_shard, jobs)
    n_games = sum(r[0] for r in results)
    n_hands = sum(r[1] for r in results)

    rows = []
    for w in range(args.workers):
        p = args.out.replace(".jsonl", f"_w{w}.jsonl")
        if os.path.exists(p):
            rows += [json.loads(l) for l in open(p)]
    if not rows:
        print("no rows measured")
        return
    print(f"\nR1 shortlist_regret — {len(rows)} decisions, {n_games} games, "
          f"{n_hands} hands")
    for role, rname in ((1, "declarer"), (0, "defender")):
        for t in (0, 1, 2):
            sub = [r for r in rows if r["trick"] == t and r["declarer"] == role]
            if not sub:
                continue
            exc = sum(r["confirmed"] for r in sub)
            g_exc = sum(r["god_excluded"] for r in sub)
            mg = (sum(r["conf_gain"] for r in sub if r["confirmed"]) / exc
                  if exc else 0.0)
            gg = (sum(r["god_gain"] for r in sub if r["god_excluded"]) / g_exc
                  if g_exc else 0.0)
            print(f"  {rname} trick {t}: n={len(sub)} "
                  f"legal-confirmed {exc} ({100*exc/len(sub):.1f}%) "
                  f"mean gain {mg:.2f} | god-excluded {g_exc} "
                  f"({100*g_exc/len(sub):.1f}%) mean {gg:.2f}")
    per_hand_legal = sum(r["conf_gain"] for r in rows if r["confirmed"]) \
        / max(n_hands, 1)
    per_hand_god = sum(r["god_gain"] for r in rows if r["god_excluded"]) \
        / max(n_hands, 1)
    print(f"  est pts/hand recoverable — legal: {per_hand_legal:.3f} "
          f"(threshold: <0.5 dead, 0.5-1.5 backlog, >1.5 build) | "
          f"god upper bound: {per_hand_god:.3f}")


if __name__ == "__main__":
    main()
