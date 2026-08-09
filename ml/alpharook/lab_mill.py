"""Laboratory mill — human-vs-RC1 decision banks from the soak corpus.

`widow` mode: every item is a real RC1 widow decision — the buyer's dealt
nine, the four widow cards, the auction result, the score, the table
positions — plus what RC1 actually chose (trump intent + the four
go-down cards). The Laboratory page shows the position, the human picks
trump + burial, then grades RC1's. Picks are replay-scored later (same
seed, frozen core) — the human-vs-bot scoreboard.

    ~/torch-env/bin/python -m alpharook.lab_mill widow \
        --n 320 --out ../public/lab/widow_items.json
"""

from __future__ import annotations

import argparse
import glob
import json
import random

from .duel import deck_stream
from .encoder import D_BID, D_DISCARD, D_TRUMP
from .env import SelfPlayGame


def mill_widow(paths, want, rng):
    items = []
    seen_games = 0
    for path in paths:
        lines = open(path).read().splitlines()
        rng.shuffle(lines)
        for line in lines:
            if len(items) >= want:
                return items
            rec = json.loads(line)
            seen_games += 1
            env = SelfPlayGame(seed=rec["seed"],
                              deck_fn=deck_stream(rec["seed"]),
                              dealer=rec["seed"] % 4,
                              win_score=rec.get("win", 500),
                              lose_score=rec.get("lose", -250))
            target_hand = rng.randrange(0, 12)
            widow_before = None
            pending = None   # item being assembled for the target hand
            picks: list[int] = []
            try:
                for (seat, dtype, action, reflex, searched, side0) in rec["d"]:
                    e_seat, e_dtype, cands = env.decision()
                    if e_seat != seat or e_dtype != dtype:
                        break
                    g = env.g
                    if dtype == D_BID:
                        widow_before = list(g.widow)
                    env.apply(action)
                    if (pending is None and g.bid_winner is not None
                            and g.hand_number == target_hand
                            and len(g.hands[g.bid_winner]) == 13
                            and widow_before):
                        b = g.bid_winner
                        hand13 = list(g.hands[b])
                        widow4 = [c for c in widow_before]
                        dealt9 = [c for c in hand13 if c not in widow4]
                        # duplicated ranks impossible (ints unique in deck)
                        t = b % 2
                        pending = dict(
                            seed=rec["seed"], hand=g.hand_number, buyer=b,
                            dealt=sorted(dealt9), widow=sorted(widow4),
                            bid=int(g.high_bid),
                            scores=[int(g.scores[t]), int(g.scores[1 - t])],
                            dealerRel=(env.g.hand_number + rec["seed"]) % 4,
                            )
                        # dealer for hand h = (seed % 4 + h) % 4; positions
                        # relative to the buyer for the table map
                        dealer = (rec["seed"] % 4 + g.hand_number) % 4
                        pending["dealerRel"] = (dealer - b) % 4
                        pending["leaderRel"] = ((dealer + 1) - b) % 4
                        picks = []
                    elif pending is not None and "rc1" not in pending:
                        if dtype == D_TRUMP and seat == pending["buyer"]:
                            pending["trumpIntent"] = int(action)
                        elif dtype == D_DISCARD and seat == pending["buyer"]:
                            picks.append(int(action))
                            if len(picks) == 4:
                                pending["rc1"] = dict(
                                    trump=pending.pop("trumpIntent", None),
                                    godown=sorted(picks))
                                items.append(pending)
                                break
            except Exception:
                continue
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["widow"])
    ap.add_argument("--corpus", default="runs/belief/soak_box*_acts.jsonl")
    ap.add_argument("--n", type=int, default=320)
    ap.add_argument("--seed", type=int, default=99)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    paths = sorted(glob.glob(args.corpus))
    items = mill_widow(paths, args.n, rng)
    rng.shuffle(items)
    for i, it in enumerate(items):
        it["id"] = i + 1
    with open(args.out, "w") as f:
        json.dump(items, f)
    trumps = {}
    for it in items:
        trumps[it["rc1"]["trump"]] = trumps.get(it["rc1"]["trump"], 0) + 1
    print(f"{len(items)} widow items -> {args.out}; rc1 trump mix {trumps}")


if __name__ == "__main__":
    main()
