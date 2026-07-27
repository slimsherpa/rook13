#!/usr/bin/env python3
"""Aggregate the ceiling shards into the answer: how far is gen21 from
perfect, and how much of that gap is actually reachable?

Read this in three sections:

  BIDDING     — did the auction buy a contract that was makeable at all?
                Par decides this with no reference to how the cards were
                played, so it CANNOT cancel between the two sides. It is
                the cleanest number in the report.
  PLAY        — of the contracts that WERE makeable, how often did the
                declaring side actually bring them home? Plus the raw
                shortfall vs par. Shortfall is two-sided (declarer errors
                minus defender errors), so read its spread, not its mean.
  HEADROOM    — per-decision double-dummy loss from trick 3 on, split into
                PREVENTABLE (the played card is wrong in most worlds this
                seat could imagine) and IRREDUCIBLE (it was right in the
                worlds it could see; only peeking beats it).

Usage: ceiling_report.py <dir-or-files>
"""
import json
import statistics as st
import sys
from pathlib import Path


def load(paths):
    recs = []
    for p in paths:
        for line in open(p):
            line = line.strip()
            if line:
                recs.append(json.loads(line))
    return recs


def pct(x, n):
    return f"{x / n:6.1%}" if n else "   n/a"


def main():
    args = sys.argv[1:] or ["runs/ceiling"]
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.glob("*.jsonl")) if p.is_dir() else [p]
    R = load(files)
    if not R:
        sys.exit("no records")
    n = len(R)
    print(f"CEILING REPORT — {n:,} hands, {len(files)} shards\n")

    # ---- BIDDING ---------------------------------------------------------
    unmakeable = [r for r in R if not r["par_makes"]]
    made = [r for r in R if r["made"]]
    print("BIDDING (par decides; cannot cancel between sides)")
    print(f"  contracts bought that par says are UNMAKEABLE : "
          f"{pct(len(unmakeable), n)}  ({len(unmakeable):,}/{n:,})")
    if unmakeable:
        over = [r["bid"] - r["par_decl"] for r in unmakeable]
        print(f"    when overbid, by how much (median)          : "
              f"{st.median(over):.0f} pts")
    slack = [r["par_decl"] - r["bid"] for r in R if r["par_makes"]]
    if slack:
        print(f"  on makeable contracts, par headroom (median)  : "
              f"{st.median(slack):.0f} pts left unbid")
    print()

    # ---- PLAY ------------------------------------------------------------
    ok = [r for r in R if r["par_makes"]]
    ok_made = [r for r in ok if r["made"]]
    bad_made = [r for r in unmakeable if r["made"]]
    print("PLAY")
    print(f"  makeable contracts actually MADE              : "
          f"{pct(len(ok_made), len(ok))}  ({len(ok_made):,}/{len(ok):,})")
    print(f"    -> makeable but went SET (play/defence gap)  : "
          f"{pct(len(ok) - len(ok_made), len(ok))}")
    print(f"  unmakeable contracts stolen anyway            : "
          f"{pct(len(bad_made), max(len(unmakeable), 1))}"
          f"  ({len(bad_made):,}/{len(unmakeable):,})")
    sh = [r["shortfall"] for r in R]
    print(f"  shortfall vs par: median {st.median(sh):+.0f}  "
          f"mean {st.mean(sh):+.1f}  sd {st.pstdev(sh):.1f}")
    print(f"    (two-sided: declarer errors minus defender errors, so a "
          f"mean near 0 is expected in self-play)")
    print()

    # ---- HEADROOM --------------------------------------------------------
    rows = [x for r in R for x in r["rows"]]
    if not rows:
        print("HEADROOM: no per-decision rows (run with --audit-from-trick)")
        return
    lossy = [x for x in rows if x["loss"] > 0]
    tot_loss = sum(x["loss"] for x in rows)
    print(f"HEADROOM — per-decision, tricks 3+ ({len(rows):,} decisions)")
    print(f"  decisions that gave up points  : {pct(len(lossy), len(rows))}")
    print(f"  mean loss per decision         : "
          f"{tot_loss / len(rows):.2f} pts")
    print(f"  mean loss per lossy decision   : "
          f"{tot_loss / max(len(lossy), 1):.1f} pts")

    for label, sel in (("declaring side", lambda x: x["decl_team"]),
                       ("defending side", lambda x: not x["decl_team"])):
        g = [x for x in rows if sel(x)]
        if g:
            print(f"    {label:15s}: {sum(x['loss'] for x in g)/len(g):.2f} "
                  f"pts/decision over {len(g):,}")

    print("\n  by trick:")
    for t in sorted({x["trick"] for x in rows}):
        g = [x for x in rows if x["trick"] == t]
        print(f"    trick {t}: {sum(x['loss'] for x in g)/len(g):5.2f} "
              f"pts/decision  ({len(g):,} decisions)")

    # the split that actually answers "how much better can we get"
    kn = [x for x in lossy if x.get("knowable") is not None]
    if kn:
        # played card best in <50% of imaginable worlds => a mortal in that
        # seat had reason to know better => PREVENTABLE
        prev = [x for x in kn if x["knowable"] < 0.5]
        irr = [x for x in kn if x["knowable"] >= 0.5]
        pl = sum(x["loss"] for x in prev)
        il = sum(x["loss"] for x in irr)
        print(f"\n  PREVENTABLE vs IRREDUCIBLE "
              f"({len(kn):,} lossy decisions sampled, "
              f"{st.mean([x['worlds'] for x in kn]):.0f} worlds each)")
        print(f"    preventable : {pct(len(prev), len(kn))} of them, "
              f"{pl / (pl + il):6.1%} of the lost points")
        print(f"    irreducible : {pct(len(irr), len(kn))} of them, "
              f"{il / (pl + il):6.1%} of the lost points")
        share = pl / (pl + il) if (pl + il) else 0
        print(f"\n  => of the {tot_loss / len(rows):.2f} pts/decision gen21 "
              f"leaves on the table from trick 3 on,")
        print(f"     roughly {share:.0%} looks REACHABLE with better play. "
              f"That is the headroom.")


if __name__ == "__main__":
    main()
