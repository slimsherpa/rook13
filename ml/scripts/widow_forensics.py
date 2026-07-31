#!/usr/bin/env python3
"""Widow forensics: WHAT does gen23's go-down/trump get wrong?

Per contract: log gen23's choice vs the hindsight-best candidate with
comparable features — trump suit length, counter points buried, voids
created, top-trump kept — then summarize the + cases (where best beats
gen23) by which features moved. This is the mimicry target list for the
per-hand widow gym.

    ~/torch-env/bin/python scripts/widow_forensics.py --hands 250
"""

import argparse
import collections
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import torch  # noqa: E402
from rook.cards import SUITS, card_points, suit_of, num_of, team_of  # noqa: E402
from rook.engine import WIDOW, HAND_DONE, GAME_OVER  # noqa: E402
from alpharook.env import SelfPlayGame  # noqa: E402
from alpharook.arena import model_choose  # noqa: E402
from alpharook.duel import deck_stream  # noqa: E402
from alpharook.encoder import D_TRUMP  # noqa: E402
from alpharook.model import load_qnet  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from godown_headroom import candidates_for, declarer_points  # noqa: E402


def choice_features(hand13, disc, trump):
    kept = [c for c in hand13 if c not in set(disc)]
    kept_by = {s: [c for c in kept if suit_of(c) == s] for s in SUITS}
    return dict(
        trump_len=len([c for c in hand13 if suit_of(c) == trump]),
        max_suit_len=max(len([c for c in hand13 if suit_of(c) == s])
                         for s in SUITS),
        buried_pts=sum(card_points(c) for c in disc),
        buried_trumps=sum(1 for c in disc if suit_of(c) == trump),
        voids_kept=sum(1 for s in SUITS if s != trump and not kept_by[s]),
        singletons_kept=sum(1 for s in SUITS
                            if s != trump and len(kept_by[s]) == 1),
        top_trump=max((num_of(c) for c in kept
                       if suit_of(c) == trump), default=0),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hands", type=int, default=250)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default="runs/gen24/widow_forensics.jsonl")
    args = ap.parse_args()
    torch.set_num_threads(2)
    net = load_qnet(args.net)
    fout = open(args.out, "w")
    n = 0
    seed = 10_000
    t0 = time.time()
    rows = []
    with torch.no_grad():
        while n < args.hands:
            seed += 1
            env = SelfPlayGame(seed=seed ^ 0xF0E1,
                               deck_fn=deck_stream(seed ^ 0xF0E1),
                               dealer=seed % 4)
            snap = None
            while not env.done and snap is None:
                s, dt, cands = env.decision()
                a = model_choose(net, "cpu", env, s, dt, cands)
                if dt == D_TRUMP and env.trump_intent is None and \
                        env.g.phase == WIDOW:
                    g0 = env.g.clone()
                    env.apply(a)
                    picks = []
                    while env.g.phase == WIDOW:
                        s2, dt2, cd = env.decision()
                        p = model_choose(net, "cpu", env, s2, dt2, cd)
                        picks.append(p)
                        env.apply(p)
                    snap = (g0, s, picks, a)
                    break
                env.apply(a)
            if snap is None:
                continue
            g0, declarer, g23_disc, g23_trump = snap
            results = {}
            for disc, trump in candidates_for(g0.hands[declarer], g23_disc,
                                              g23_trump):
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
                made = not g.hand_history[-1][6]
                results[(disc, trump)] = (made, declarer_points(g, declarer))
            own_key = (tuple(sorted(g23_disc)), g23_trump)
            own = results[own_key]
            best_key = max(results,
                           key=lambda k: (results[k][0], results[k][1]))
            best = results[best_key]
            hand13 = g0.hands[declarer]
            row = dict(
                seed=seed, bid=g0.high_bid,
                own=dict(made=own[0], pts=own[1],
                         **choice_features(hand13, *own_key)),
                best=dict(made=best[0], pts=best[1],
                          **choice_features(hand13, *best_key)),
                gap=best[1] - own[1],
                same=own_key == best_key,
                trump_changed=own_key[1] != best_key[1],
            )
            rows.append(row)
            fout.write(json.dumps(row) + "\n")
            fout.flush()
            n += 1
            if n % 50 == 0:
                print(f"  [{n}/{args.hands}] ({(time.time()-t0)/n:.1f}s/hand)",
                      flush=True)

    # ---- summary: what does BEST do differently on the hands gen23 got
    # wrong (gap > 0)?
    wrong = [r for r in rows if not r["same"] and r["gap"] > 0]
    print(f"\nWIDOW FORENSICS — {len(rows)} contracts, "
          f"{len(wrong)} where gen23's choice lost points:")
    print(f"  trump suit CHANGED in {sum(1 for r in wrong if r['trump_changed'])}"
          f"/{len(wrong)} of them")
    for feat in ("trump_len", "buried_pts", "buried_trumps", "voids_kept",
                 "singletons_kept", "top_trump"):
        o = statistics.mean(r["own"][feat] for r in wrong)
        b = statistics.mean(r["best"][feat] for r in wrong)
        print(f"  {feat:16s}: gen23 {o:5.2f} -> best {b:5.2f}  "
              f"({b - o:+.2f})")
    flips = [r for r in wrong if r["best"]["made"] and not r["own"]["made"]]
    print(f"  set->made flips among them: {len(flips)}")
    # short-trump sin (the family complaint)
    short = [r for r in rows if r["own"]["trump_len"]
             < r["own"]["max_suit_len"]]
    print(f"  contracts where gen23 trumped SHORTER than its longest suit: "
          f"{len(short)}/{len(rows)}")


if __name__ == "__main__":
    main()
