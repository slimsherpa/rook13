#!/usr/bin/env python3
"""Incremental corpus counter — runs on each box AND the MBP.

Corpus shards are append-only, so this keeps a byte-offset cache per file
and only parses lines written since the last run. Without the cache the
board would re-read multi-GB shards every 2 minutes by day two.

Emits one JSON object to stdout:
  {"ts": ..., "streams": N, "write_age_s": S,
   "mar": {"games","hands","ovr","srch"}, "std": {...},
   "duel": {"games","wins"}}       # corpus-era marathon games only,
                                   # deduped on (seed, flip)
Stdlib only — the MBP pushes its output to the hub with plain python3.
"""
import glob
import json
import os
import subprocess
import sys
import time

RUNS = sys.argv[sys.argv.index("--runs-dir") + 1] \
    if "--runs-dir" in sys.argv else "/root/rook13/ml/runs"
CACHE = sys.argv[sys.argv.index("--cache") + 1] \
    if "--cache" in sys.argv else "/root/status/count_cache.json"

try:
    with open(CACHE) as f:
        cache = json.load(f)
except Exception:
    cache = {"files": {}, "dump": {}, "seen": {}}


def scan_corpus(path):
    st = cache["files"].get(path, [0, 0, 0, 0, 0])
    off, games, hands, ovr, srch = st
    size = os.path.getsize(path)
    if size < off:                     # truncated/rotated: rescan
        off, games, hands, ovr, srch = 0, 0, 0, 0, 0
    with open(path) as f:
        f.seek(off)
        for line in f:
            if not line.endswith("\n"):
                break                  # torn tail: re-read next run
            off += len(line)
            try:
                r = json.loads(line)
            except Exception:
                continue
            games += 1
            hands += r["hands"]
            ovr += r["n_ovr"]
            srch += r.get("n_srch", 0)
    cache["files"][path] = [off, games, hands, ovr, srch]
    return games, hands, ovr, srch


def scan_dump(path):
    """Marathon measurement games, corpus-era only (rows carrying seed),
    deduped: resume relaunches replay pre-fix pairs into the same file."""
    st = cache["dump"].get(path, [0, 0, 0])
    off, games, wins = st
    size = os.path.getsize(path)
    if size < off:
        off, games, wins = 0, 0, 0
    seen = cache["seen"]
    with open(path) as f:
        f.seek(off)
        for line in f:
            if not line.endswith("\n"):
                break
            off += len(line)
            try:
                r = json.loads(line)
            except Exception:
                continue
            if "seed" not in r:
                continue
            k = f'{r["seed"]}:{r["flip"]}'
            if k in seen:
                continue
            seen[k] = 1
            games += 1
            wins += 1 if r["w"] == 0 else 0
    cache["dump"][path] = [off, games, wins]
    return games, wins


def tally(pats, kind):
    tot = [0, 0, 0, 0]
    for pat in pats:
        for p in sorted(glob.glob(os.path.join(RUNS, pat))):
            g, h, o, s = scan_corpus(p)
            for i, v in enumerate((g, h, o, s)):
                tot[i] += v
    return dict(zip(("games", "hands", "ovr", "srch"), tot))


mar = tally(["t0corpus_box*.jsonl", "t0corpus_mbp_x*.jsonl"], "mar")
std = tally(["t0corpus_std_*.jsonl"], "std")

dg = dw = 0
for pat in ("g21_vs_t0_box*.jsonl", "g21_vs_t0_mbp_x*.jsonl"):
    for p in sorted(glob.glob(os.path.join(RUNS, pat))):
        if "_std_" in p:
            continue
        g, w = scan_dump(p)
        dg += g
        dw += w

try:
    streams = int(subprocess.run(
        ["pgrep", "-fc", "[-]-dump runs/g21_vs_t0"],
        capture_output=True, text=True).stdout.strip() or 0)
except Exception:
    streams = -1
if streams <= 0:      # macOS pgrep has no -c
    try:
        out = subprocess.run(["pgrep", "-f", "[-]-dump runs/g21_vs_t0"],
                             capture_output=True, text=True).stdout
        streams = len(out.split())
    except Exception:
        streams = -1

mtimes = [os.path.getmtime(p) for p in
          glob.glob(os.path.join(RUNS, "t0corpus_*.jsonl"))]
age = round(time.time() - max(mtimes)) if mtimes else None

os.makedirs(os.path.dirname(CACHE), exist_ok=True)
tmp = CACHE + ".tmp"
with open(tmp, "w") as f:
    json.dump(cache, f)
os.replace(tmp, CACHE)

print(json.dumps(dict(ts=time.time(), streams=streams, write_age_s=age,
                      mar=mar, std=std,
                      duel=dict(games=dg, wins=dw))))
