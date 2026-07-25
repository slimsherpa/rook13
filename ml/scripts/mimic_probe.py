#!/usr/bin/env python3
"""Per-box mimic generation probe: prints one JSON summary line.
Run by hil-1's fleet_status.py over ssh every 10 minutes."""
import glob, json, os, subprocess, time

SHARDS = "/root/rook13/ml/runs/mimic1/shards/*.jsonl"

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True,
                          text=True).stdout.strip()

total, newest = 0, 0.0
games = srch = ovr = dec = 0
sec = 0.0
for f in sorted(glob.glob(SHARDS)):
    n = sh(f"wc -l < {f}")
    total += int(n or 0)
    newest = max(newest, os.path.getmtime(f))
    for line in sh(f"tail -n 5 {f}").splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        games += 1
        srch += r["n_srch"]
        ovr += r["n_ovr"]
        dec += r["n_dec"]
        sec += r["sec"]
workers = sh("pgrep -c -f '[g]en_mimic'")
print(json.dumps(dict(total=total, age_min=round((time.time() - newest) / 60, 1)
                      if newest else -1,
                      workers=int(workers or 0), recent=games, srch=srch,
                      ovr=ovr, dec=dec, sec=round(sec, 1))))
