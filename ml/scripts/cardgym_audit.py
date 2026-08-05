#!/usr/bin/env python3
"""Audit the cardplay-gym corpus BEFORE trusting it (house rule #2:
test the test — and audit the artifact, not the code).

Answers, from actual rows:
  - volume + throughput (rows, games touched, candidates/row)
  - self-check integrity is reported by the gym itself (watch w0 lines);
    here: chosen-card row must exist with adv 0 in every record
  - HOW LOUD is the surface: |adv| distribution over non-chosen
    candidates — near-ties are noise no reflex should memorize (the
    gen23 quiz lesson); the loud tail is the treasure
  - WHERE it is loud: mean |best regret| by trick, by role
    (regret = max candidate adv; >0 means gen23's card was beaten
    in this world — hindsight, so read it as headroom-shaped, not error)
  - packed-state sanity: dim, finite, nonzero fraction

Usage: cardgym_audit.py [shard-dir]
"""
import glob
import json
import statistics as st
import sys

sys.path.insert(0, "ml")
sys.path.insert(0, ".")


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "runs/gen24/cardgym/shards"
    files = sorted(glob.glob(f"{d}/*.jsonl"))
    if not files:
        sys.exit(f"no shards in {d}")
    R = []
    for p in files:
        for line in open(p):
            line = line.strip()
            if line:
                R.append(json.loads(line))
    n = len(R)
    games = len({r["seed"] for r in R})
    print(f"CARDGYM AUDIT — {n:,} snapshot rows, {games:,} games, "
          f"{len(files)} shards")

    # integrity: chosen row present, adv 0, and exactly once
    bad = sum(1 for r in R
              if sum(1 for c in r["cands"] if c["c"] == r["chosen"]) != 1
              or next(c["adv"] for c in r["cands"]
                      if c["c"] == r["chosen"]) != 0)
    print(f"  chosen-row integrity fails : {bad}")

    ncands = [len(r["cands"]) for r in R]
    print(f"  candidates/row             : mean {st.mean(ncands):.1f}  "
          f"min {min(ncands)}  max {max(ncands)}")

    # loudness over non-chosen candidates
    advs = [abs(c["adv"]) for r in R for c in r["cands"]
            if c["c"] != r["chosen"]]
    if advs:
        buckets = [(0, 0), (1, 5), (6, 20), (21, 50), (51, 100),
                   (101, 10_000)]
        print(f"  |adv| of alternatives ({len(advs):,} candidate rollouts):")
        for lo, hi in buckets:
            k = sum(1 for a in advs if lo <= a <= hi)
            label = f"{lo}" if lo == hi else f"{lo}-{hi if hi < 10_000 else '+'}"
            print(f"    {label:>7}: {k / len(advs):6.1%}")

    # regret = best alternative's adv (how often was gen23's card beaten
    # in this world, and by how much)
    regs = [max((c["adv"] for c in r["cands"] if c["c"] != r["chosen"]),
                default=0) for r in R]
    beat = [x for x in regs if x > 0]
    print(f"  gen23's card beaten in-world: {len(beat) / n:.1%} of rows; "
          f"when beaten, mean +{st.mean(beat):.1f} median "
          f"+{st.median(beat):.0f}")

    def slice_regret(label, keyf):
        print(f"  mean best-regret by {label}:")
        keys = sorted({keyf(r) for r in R})
        for k in keys:
            g = [max((c["adv"] for c in r["cands"] if c["c"] != r["chosen"]),
                     default=0) for r in R if keyf(r) == k]
            gpos = [x for x in g if x > 0]
            print(f"    {k!s:>10}: {st.mean(g):6.1f} pts "
                  f"(beaten {len(gpos)/len(g):5.1%}, n={len(g):,})")

    slice_regret("trick", lambda r: r["trick"])
    slice_regret("role", lambda r: ("declarer" if r["declarer"] else
                                    "decl-partner" if r["decl_team"] else
                                    "defender"))

    # packed state sanity
    from alpharook.encoder import STATE_DIM_V4
    from alpharook.cardgym_data import unpack_state
    import numpy as np
    xs = [unpack_state(r["x"], STATE_DIM_V4) for r in R[:200]]
    X = np.stack(xs)
    print(f"  packed state: dim {X.shape[1]}, finite {np.isfinite(X).all()}, "
          f"nonzero frac {(X != 0).mean():.2f}, "
          f"range [{X.min():.2f}, {X.max():.2f}]")


if __name__ == "__main__":
    main()
