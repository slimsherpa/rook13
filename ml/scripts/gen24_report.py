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
    files = sorted(glob.glob(pattern))
    if not files:
        return None
    with open(files[-1]) as f:
        return json.load(f)


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
