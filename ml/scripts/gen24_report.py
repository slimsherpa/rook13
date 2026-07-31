#!/usr/bin/env python3
"""Assemble the gen24 curiosity-artifact data bundle.

    ~/torch-env/bin/python scripts/gen24_report.py [--out runs/gen24]

Reads every city's state.json, the latest world cup, and the latest probe;
writes runs/gen24/report.json — everything the artifact page embeds.
Rerun any time; the artifact is regenerated from this file.
"""

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from alpharook.bidcity import CULTURES  # noqa: E402
from alpharook.bidgenes import GENE_SPECS, GENE_NAMES, default_genome  # noqa: E402


def _pair_specs():
    from alpharook.bidpairs import PAIR_GENES
    return {k: dict(lo=v[0], hi=v[1], sigma=v[2]) for k, v in PAIR_GENES.items()}

TRAJ_GENES = ["base", "per_trick", "war_stretch", "jump_gap",
              "deficit_slope", "desperation", "protection", "cliff_fear"]


def city_bundle(out_dir: str, city: str):
    path = os.path.join(out_dir, city, "state.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        st = json.load(f)
    if not st["history"]:
        return None
    hist = st["history"]
    champ = st["hof"][-1]

    traj = dict(season=[], family=[], gen23=[], champ=[])
    gene_traj = {g: [] for g in TRAJ_GENES}
    for h, hof in zip(hist, st["hof"]):
        by = {r["name"]: r for r in h["table"]}
        traj["season"].append(h["season"])
        for a in ("family", "gen23"):
            r = by.get(a)
            traj[a].append(round(r["wins"] / max(1, r["games"]), 4) if r else None)
        cr = by.get(hof["name"])
        traj["champ"].append(round(cr["wins"] / max(1, cr["games"]), 4) if cr else None)
        for g in TRAJ_GENES:
            gene_traj[g].append(round(hof["genome"][g], 3))

    return dict(
        city=city, desc=CULTURES[city]["desc"], season=st["season"],
        table=hist[-1]["table"],
        champ=dict(name=champ["name"], genome=champ["genome"]),
        traj=traj, gene_traj=gene_traj,
        games_played=sum(r["games"] for r in hist[-1]["table"]) // 2 * len(hist),
    )


def latest(pattern: str):
    files = sorted(glob.glob(pattern), key=os.path.getmtime)
    if not files:
        return None
    with open(files[-1]) as f:
        return json.load(f)


# The oracle sweep record (arms are cheap 40-60 pair reads; the story is
# the gradient, so the table is committed here as part of the report).
ORACLE_ARMS = [
    dict(arm="A", cfg="K16 · listen", rate=0.362, ci=0.085, n=80),
    dict(arm="B", cfg="K16 · deaf", rate=0.312, ci=0.090, n=80),
    dict(arm="C", cfg="K32 · listen · tight", rate=0.462, ci=0.100, n=80),
    dict(arm="D", cfg="K32 · listen · thin margin", rate=0.475, ci=0.104, n=80),
    dict(arm="E", cfg="K48 · listen", rate=0.388, ci=0.088, n=80),
    dict(arm="F", cfg="K64 · listen", rate=0.488, ci=0.088, n=80),
    dict(arm="G", cfg="adaptive K24/96 · listen", rate=0.450, ci=0.079, n=120),
]


def pairs_bundle(out_dir: str):
    path = os.path.join(out_dir, "pairs", "state.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        st = json.load(f)
    if not st["history"]:
        return None
    last = st["history"][-1]
    champ_name = last["table"][0]["name"]
    champ = next(p for p in st["pairs"] if p["name"] == champ_name)
    gauntlets = [dict(season=g["season"],
                      best=g["rows"][0]["rate"],
                      best_name=g["rows"][0]["name"],
                      median=g["rows"][len(g["rows"]) // 2]["rate"])
                 for g in st["gauntlets"]]
    return dict(season=st["season"], table=last["table"],
                conventions=last.get("conventions", {}),
                champ=dict(name=champ["name"], first=champ["first"],
                           second=champ["second"], gA=champ["gA"],
                           gB=champ["gB"], born=champ["born"]),
                gauntlets=gauntlets, hof=st["hof"][-8:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="runs/gen24")
    args = ap.parse_args()
    out = args.out if os.path.isdir(args.out) else \
        os.path.join(os.path.dirname(__file__), "..", args.out)

    cities = {c: city_bundle(out, c) for c in CULTURES}
    report = dict(
        generated=time.time(),
        gene_specs={k: dict(lo=v[0], hi=v[1], sigma=v[2], default=v[3])
                    for k, v in GENE_SPECS.items()},
        gene_names=GENE_NAMES,
        family_genome=default_genome(),
        cities={k: v for k, v in cities.items() if v},
        cup=latest(os.path.join(out, "worldcup", "cup_*.json")),
        probe=latest(os.path.join(out, "probe", "probe_*.json")),
        pairs=pairs_bundle(out),
        bidbrain=latest(os.path.join(out, "bidbrain", "firstread_*.json")),
        oracle=dict(
            arms=ORACLE_ARMS,
            dialect=dict(passed=[1.78, 0.92], b100=[3.12, 1.24],
                         b105=[4.02, 1.10], b110=[4.78, 0.96],
                         crawl=[2.93, 1.20]),
        ),
        pair_gene_specs=_pair_specs(),
    )
    path = os.path.join(out, "report.json")
    with open(path, "w") as f:
        json.dump(report, f)
    sz = os.path.getsize(path) / 1024
    print(f"-> {path} ({sz:.0f} KB), cities: "
          f"{[f'{k} s{v['season']}' for k, v in report['cities'].items()]}, "
          f"cup: {bool(report['cup'])}, probe: {bool(report['probe'])}")

    # rebuild the artifact page alongside the data: runs/gen24/bidgym.html.
    # (Claude republishes this file to the claude.ai artifact URL on request.)
    tpl_path = os.path.join(os.path.dirname(__file__),
                            "gen24_artifact_template.html")
    if os.path.exists(tpl_path):
        with open(tpl_path) as f:
            tpl = f.read()
        with open(path) as f:
            blob = f.read()
        html_path = os.path.join(out, "bidgym.html")
        with open(html_path, "w") as f:
            f.write(tpl.replace("/*__DATA__*/", "const DATA = " + blob + ";"))
        print(f"-> {html_path}")


if __name__ == "__main__":
    main()
