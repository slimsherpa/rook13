#!/usr/bin/env python3
"""Go-down/trump HEADROOM scan (Riley's isolation experiment, 2026-07-31).

Per contract hand, hold everything fixed — the deal, the auction, the
frozen gen23 card play on all four seats — and vary ONLY the declarer's
(go-down, trump) choice. Evaluate each candidate by deterministic
rollout in the TRUE world. Report how many points gen23's actual choice
leaves on the table vs the hindsight-best candidate, and how often its
choice was already optimal.

This is a CEILING (hindsight-best overfits the true world); if the
ceiling is thin, no selection policy can be worth much and the question
is closed. If it is fat, a K-world observable chooser (Phase B, running
in parallel via duel.py --search-a discard,trump) has room to collect.

    ~/torch-env/bin/python scripts/godown_headroom.py --hands 200
"""

import argparse
import itertools
import os
import random
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch  # noqa: E402
from rook.cards import PASS, SUITS, card_points, suit_of, num_of, team_of  # noqa: E402
from rook.engine import WIDOW, HAND_DONE, GAME_OVER, TRICKS_PER_HAND  # noqa: E402
from rook.bots import choose_go_down, best_trump_suit  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.arena import model_choose  # noqa: E402
from alpharook.duel import deck_stream  # noqa: E402
from alpharook.encoder import D_BID, D_TRUMP, D_DISCARD  # noqa: E402
from alpharook.model import load_qnet  # noqa: E402


def declarer_points(g, declarer):
    """Raw points the declarer's team captured this hand (points taken +
    go-down if they won the last trick + the 5-trick bonus) — comparable
    across candidates whether the contract made or not."""
    team = team_of(declarer)
    pts = g.points_taken[team]
    last_winner = g.completed_tricks[-1][2]
    if team_of(last_winner) == team:
        pts += g.go_down_points()
    if g.tricks_won[team] >= 5:
        pts += 20
    return pts


def candidates_for(hand13, gen23_discard, gen23_trump):
    """~140 candidates: for each trump suit, the family-heuristic discard,
    gen23's own pick, plus random 4-subsets weighted to weak cards."""
    rng = random.Random(hash(tuple(sorted(hand13))) & 0xFFFF)
    out = set()
    out.add((tuple(sorted(gen23_discard)), gen23_trump))
    for trump in SUITS:
        if len([c for c in hand13 if suit_of(c) == trump]) == 0:
            continue
        heur = choose_go_down(list(hand13), trump)
        out.add((tuple(sorted(heur)), trump))
        non_trump = [c for c in hand13 if suit_of(c) != trump]
        pool = non_trump if len(non_trump) >= 4 else list(hand13)
        # weak-biased random subsets
        weights = [1.0 / (1 + num_of(c) + 2 * card_points(c)) for c in pool]
        for _ in range(30):
            picks = set()
            while len(picks) < 4:
                picks.add(rng.choices(pool, weights=weights, k=1)[0])
            out.add((tuple(sorted(picks)), trump))
    return list(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=200)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    args = ap.parse_args()
    torch.set_num_threads(2)
    net = load_qnet(args.net)

    left_pts = []
    optimal = 0
    made_flip_gain = 0   # hands where best makes but gen23's choice sets
    made_flip_loss = 0
    n = 0
    seed = 0
    t0 = time.time()
    with torch.no_grad():
        while n < args.hands:
            seed += 1
            env = SelfPlayGame(seed=seed ^ 0x60D0,
                               deck_fn=deck_stream(seed ^ 0x60D0),
                               dealer=seed % 4)
            # play until a widow state (auction just ended), snapshot
            snap = None
            while not env.done and snap is None:
                s, dt, cands = env.decision()
                a = model_choose(net, "cpu", env, s, dt, cands)
                if dt == D_TRUMP and env.trump_intent is None and \
                        env.g.phase == WIDOW:
                    # capture the frozen widow state + gen23's full choice
                    g0 = env.g.clone()
                    declarer = s
                    gen23_trump = a
                    # let gen23 finish its discard to record its choice
                    env.apply(a)
                    picks = []
                    while env.g.phase == WIDOW:
                        s2, dt2, cd = env.decision()
                        pick = model_choose(net, "cpu", env, s2, dt2, cd)
                        picks.append(pick)
                        env.apply(pick)
                    snap = (g0, declarer, picks, gen23_trump)
                    break
                env.apply(a)
            if snap is None:
                continue
            g0, declarer, g23_disc, g23_trump = snap
            bid = g0.high_bid
            cands = candidates_for(g0.hands[declarer], g23_disc, g23_trump)
            results = {}
            for disc, trump in cands:
                g = g0.clone()
                g.select_go_down(declarer, list(disc))
                g.select_trump(declarer, trump)

                class _E:
                    pass
                e = _E()
                e.g = g
                e.picks = []
                e.trump_intent = None
                while g.phase not in (HAND_DONE, GAME_OVER):
                    st = g.turn
                    g.play_card(st, model_choose(net, "cpu", e, st, 3,
                                                 g.legal_cards(st)))
                h = g.hand_history[-1]
                made = not h[6]
                results[(disc, trump)] = (made, declarer_points(g, declarer))
            own = results[(tuple(sorted(g23_disc)), g23_trump)]
            best_key = max(results,
                           key=lambda k: (results[k][0], results[k][1]))
            best = results[best_key]
            n += 1
            gap = best[1] - own[1]
            left_pts.append(gap)
            if gap <= 0:
                optimal += 1
            if best[0] and not own[0]:
                made_flip_gain += 1
            if n % 25 == 0:
                print(f"  [{n}/{args.hands}] gen23 optimal {optimal/n:.0%}, "
                      f"median pts left {statistics.median(left_pts):.0f}, "
                      f"make-flips {made_flip_gain} "
                      f"({(time.time()-t0)/n:.1f}s/hand)", flush=True)

    print(f"\nGO-DOWN/TRUMP HEADROOM — {n} contracts, hindsight ceiling:")
    print(f"  gen23's choice already optimal: {optimal/n:.0%}")
    print(f"  points left on table: median "
          f"{statistics.median(left_pts):.0f}, mean "
          f"{statistics.mean(left_pts):.1f}")
    print(f"  hands where a different widow FLIPS set->made: "
          f"{made_flip_gain}/{n} = {made_flip_gain/n:.0%}")


if __name__ == "__main__":
    main()
