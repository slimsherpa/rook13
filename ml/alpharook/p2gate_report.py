"""P2 gate battery report — Riley's evaluation panel over duel dumps.

For each dump (one JSONL of duel games, consecutive lines = one
duplicate-deck pair): game win rate, final scores, auction posture
(average bid, bid distribution, bids by score situation), contract
outcomes (made rate, got-set rate, set-the-others rate), and the twin
metrics (paired per-hand points; of the hands where the SAME deal went
to different teams in the two games — the skill-decided hands — how many
swung side A's way).

Score situation = side's running margin before the hand (from summed
hand diffs — absolute team scores aren't in the game dump, the margin
is the axis that matters).

    ~/torch-env/bin/python -m alpharook.p2gate_report runs/p2gate/*.jsonl
"""

from __future__ import annotations

import glob
import json
import statistics as st
import sys


BINS = ((-10_000, -150, "way behind"), (-150, -40, "behind"),
        (-40, 40, "close"), (40, 150, "ahead"), (150, 10_000, "way ahead"))


def bin_of(margin: int) -> str:
    for lo, hi, name in BINS:
        if lo <= margin < hi:
            return name
    return "close"


def report(path: str) -> None:
    games = [json.loads(l) for l in open(path) if l.strip()]
    if not games:
        print(f"\n== {path}: empty")
        return
    n = len(games)
    wins = sum(g["a"] > g["b"] for g in games)
    print(f"\n== {path.split('/')[-1]}: {n} games ({n // 2} pairs)")
    print(f"  game win rate A: {100 * wins / n:.1f}%  "
          f"(final avg {st.mean(g['a'] for g in games):.0f} vs "
          f"{st.mean(g['b'] for g in games):.0f})")

    # auction posture + contract outcomes, by side
    for side, label in ((0, "A"), (1, "B")):
        bids, made, got_set = [], 0, 0
        by_bin: dict[str, list[int]] = {}
        opp_contracts = opp_set = 0
        for g in games:
            margin = 0
            for bidder, bid, mk, diff in g["hh"]:
                m = margin if side == 0 else -margin
                if bidder == side:
                    bids.append(bid)
                    made += mk
                    got_set += 1 - mk
                    by_bin.setdefault(bin_of(m), []).append(bid)
                else:
                    opp_contracts += 1
                    opp_set += 1 - mk
                margin += diff
        if not bids:
            continue
        dist: dict[int, int] = {}
        for b in bids:
            dist[b] = dist.get(b, 0) + 1
        top = "  ".join(f"{b}:{c}" for b, c in sorted(dist.items()))
        print(f"  [{label}] contracts {len(bids)} "
              f"({100 * len(bids) / (len(bids) + opp_contracts):.0f}% of hands)"
              f"  avg bid {st.mean(bids):.1f}  made {100 * made / len(bids):.0f}%"
              f"  got set {100 * got_set / len(bids):.0f}%"
              f"  set opp {100 * opp_set / max(opp_contracts, 1):.0f}%")
        print(f"       bid dist: {top}")
        situ = "  ".join(
            f"{name}: {st.mean(v):.0f} (n{len(v)})"
            for name in [b[2] for b in BINS]
            if (v := by_bin.get(name)))
        print(f"       avg bid by situation: {situ}")

    # twin metrics over aligned pairs
    hand_sums, a_swing, b_swing, luck = [], 0, 0, 0
    for i in range(0, n - 1, 2):
        g1, g2 = games[i], games[i + 1]
        for h1, h2 in zip(g1["hh"], g2["hh"]):
            hand_sums.append((h1[3] + h2[3]) / 2)
            a1, a2 = h1[3] > 0, h2[3] > 0    # A took the points this hand?
            if a1 and a2:
                a_swing += 1
            elif not a1 and not a2:
                b_swing += 1
            else:
                luck += 1
    if hand_sums:
        m = st.mean(hand_sums)
        se = st.pstdev(hand_sums) / len(hand_sums) ** 0.5
        tot = a_swing + b_swing + luck
        print(f"  paired per-hand: {m:+.2f} ± {2 * se:.2f} pts "
              f"({len(hand_sums)} hand-pairs)")
        print(f"  same-deal verdicts: cards decided {100 * luck / tot:.0f}%"
              f"  | skill hands -> A {100 * a_swing / max(a_swing + b_swing, 1):.0f}%"
              f"  (A both {a_swing}, B both {b_swing})")


def main() -> None:
    paths: list[str] = []
    for a in sys.argv[1:]:
        paths.extend(sorted(glob.glob(a)))
    for p in paths:
        try:
            report(p)
        except Exception as e:  # partial mid-write lines are fine to skip
            print(f"\n== {p}: unreadable ({e})")


if __name__ == "__main__":
    main()
