#!/usr/bin/env python3
"""Fleet dashboard v3 — MIMIC era (gen21 teacher-data generation).

The gen19 champion stack (gen13 reflex + gen15 belief worlds + K=24 PIMC,
endgame gate t>=3) plays ALL FOUR seats; every decision is logged as a
supervised label for the mimic student. 'override rows' = decisions where
search disagreed with bare gen13 — the one-play-per-hand that makes the
stack better, pre-labeled. Cron: every 10 min on hil-1; served on :8080."""
import json, os, subprocess, time

CITIES = [("city1", None), ("city2", "5.78.130.139"),
          ("city3", "5.78.128.203"), ("city4", "5.78.135.83")]
PROBE = "python3 /root/rook13/ml/mimic_probe.py"
PREV = "/root/status/prev_mimic.json"


def probe(ip):
    try:
        if ip is None:
            out = subprocess.run(PROBE, shell=True, capture_output=True,
                                 text=True, timeout=60).stdout
        else:
            out = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 f"root@{ip}", PROBE],
                capture_output=True, text=True, timeout=60).stdout
        return json.loads(out.strip().splitlines()[-1])
    except Exception:
        return None


prev = {}
if os.path.exists(PREV):
    try:
        prev = json.load(open(PREV))
    except Exception:
        prev = {}
now = time.time()
rows, fleet_total, fleet_rate = [], 0, 0.0
new_prev = {"ts": now}
for name, ip in CITIES:
    d = probe(ip)
    if d is None:
        rows.append(f"<tr><td>{name}</td><td colspan=5 "
                    f"style='color:#f66'>NO DATA</td></tr>")
        continue
    fleet_total += d["total"]
    new_prev[name] = d["total"]
    rate = ""
    if name in prev and now > prev.get("ts", now):
        per_day = (d["total"] - prev[name]) * 86400.0 / (now - prev["ts"])
        if per_day > 0:
            fleet_rate += per_day
            rate = f"{per_day/1000:.1f}k/day"
    ovr_pct = 100.0 * d["ovr"] / d["srch"] if d["srch"] else 0
    spg = d["sec"] / d["recent"] if d["recent"] else 0
    ok = d["workers"] == 7 and 0 <= d["age_min"] < 15
    verdict = "GENERATING" if ok else "CHECK ME"
    color = "#4c4" if ok else "#f66"
    rows.append(
        f"<tr><td>{name}</td>"
        f"<td style='color:{color};font-weight:bold'>{verdict}</td>"
        f"<td>{d['total']:,} games · {d['workers']}/7 workers</td>"
        f"<td>{rate}</td>"
        f"<td>search {d['srch']}/{d['dec']} · override {ovr_pct:.0f}% · "
        f"{spg:.1f}s/game</td>"
        f"<td>{d['age_min']:.0f}m</td></tr>")

os.makedirs("/root/status", exist_ok=True)
json.dump(new_prev, open(PREV, "w"))

est_rows = int(fleet_total * 400)      # ~400 labeled decisions per game
est_ovr = int(fleet_total * 45)        # ~45 override rows per game
page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=300>
<title>MIMIC fleet — gen21</title>
<style>body{{background:#111;color:#ddd;font:14px/1.5 monospace;padding:24px}}
table{{border-collapse:collapse;margin:12px 0}}
td,th{{border:1px solid #333;padding:6px 12px;text-align:left}}
h1{{font-size:18px}} .sub{{color:#888}}</style></head><body>
<h1>&#127183; MIMIC era — gen21 teacher-data generation</h1>
<p class=sub>updated {time.strftime('%H:%M:%S')} · S5 league ARCHIVED
2026-07-25 (parity verdict: best fighter 49.8% vs gen13 over 1000 games) ·
now: the champion stack (gen13+belief+K24 search) plays all four seats,
every decision becomes a supervised label for the mimic student</p>
<table><tr><th>city</th><th>verdict</th><th>progress</th><th>rate</th>
<th>recent games (last 5/worker)</th><th>log age</th></tr>
{''.join(rows)}</table>
<p><b>fleet total: {fleet_total:,} games</b>
{f' · {fleet_rate/1000:.0f}k games/day' if fleet_rate else ''}
 · est {est_rows:,} labeled decisions · est {est_ovr:,} override rows
(the needles: search beat reflex there)</p>
<p class=sub>next: encoder v4 (human-complete observation: dealer-relative
seat, full auction transcript) + student BC training. Riley's cadence:
check-ins ~10am / ~10pm MT. If CHECK ME: ping Claude.</p>
</body></html>"""
open("/root/status/index.html", "w").write(page)
