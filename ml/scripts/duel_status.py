#!/usr/bin/env python3
"""T0 CORPUS BOARD — http://5.78.115.122:8080/

Cron on hil-1 every 2 min. One question, answered at a glance: is the
teacher bank growing, how far up the quality ladder are we, and is every
machine healthy? Riley's units are GAMES (what he can count), so the
game -> hands -> teacher-rows -> needles conversion is printed right on
the page; rows are estimated from hands (measured rows/hand), needles are
EXACT (n_ovr summed from every record).

Each box runs scripts/corpus_count.py locally (incremental byte-offset
cache — shards are GBs by day two). The MBP can't be reached from here,
so it PUSHES its own counter output to /root/status/mbp.json every 5 min;
a stale file means the laptop is asleep, which is a fact worth showing,
not an error.
"""
import json
import math
import subprocess
import time
from pathlib import Path

BOXES = [(1, None), (2, "5.78.130.139"), (3, "5.78.128.203"),
         (4, "5.78.135.83"), (5, "5.78.145.180")]
MBP_JSON = Path("/root/status/mbp.json")
HIST = Path("/root/status/corpus_hist.json")
WINDOW_S = 60 * 60          # rate over trailing hour
DAILY_COST = 25.0           # Riley's number: the 5-box fleet, $/day

ROWS_PER_HAND = {"mar": 21.8, "std": 24.0}   # measured by milling shards
EXPECTED = {1: 4, 2: 4, 3: 4, 4: 4, 5: 4, "mbp": 3}

# the quality ladder (teacher rows) — grounded in gen21's proven recipe
LADDER = [("good", 18e6, "gen21's needle budget"),
          ("great", 30e6, "the scale that minted gen21"),
          ("excellent", 45e6, "plan of record: train here"),
          ("ideal", 75e6, "two epochs unique data; past this, data "
                          "stops being the bottleneck")]


def counter_for(ip):
    cmd = "python3 /root/rook13/ml/scripts/corpus_count.py"
    try:
        if ip is None:
            out = subprocess.run(["bash", "-c", cmd], capture_output=True,
                                 text=True, timeout=90).stdout
        else:
            out = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 f"root@{ip}", cmd], capture_output=True, text=True,
                timeout=90).stdout
        return json.loads(out.strip().splitlines()[-1])
    except Exception:
        return None


def rows_est(src):
    return (src["mar"]["hands"] * ROWS_PER_HAND["mar"]
            + src["std"]["hands"] * ROWS_PER_HAND["std"])


def fmt_n(x):
    if x >= 1e6:
        return f"{x / 1e6:.1f}M"
    if x >= 1e3:
        return f"{x / 1e3:.0f}k"
    return f"{x:.0f}"


def fmt_eta(secs):
    if secs is None:
        return "&mdash;"
    if secs <= 0:
        return "&#10003; reached"
    if secs < 5400:
        return f"{secs / 60:.0f} min"
    if secs < 129600:
        return f"{secs / 3600:.1f} hr"
    return f"{secs / 86400:.1f} days"


def main():
    now = time.time()
    sources = {}
    for i, ip in BOXES:
        sources[f"box{i}"] = counter_for(ip)
    try:
        mbp = json.loads(MBP_JSON.read_text())
        mbp["_age"] = now - mbp["ts"]
        sources["mbp"] = mbp
    except Exception:
        sources["mbp"] = None

    live = {k: v for k, v in sources.items() if v}
    tot_rows = sum(rows_est(v) for v in live.values())
    tot_ovr = sum(v["mar"]["ovr"] + v["std"]["ovr"] for v in live.values())
    tot_games = sum(v["mar"]["games"] + v["std"]["games"]
                    for v in live.values())
    tot_hands = sum(v["mar"]["hands"] + v["std"]["hands"]
                    for v in live.values())
    duel_g = sum(v["duel"]["games"] for v in live.values())
    duel_w = sum(v["duel"]["wins"] for v in live.values())

    # trailing rate from snapshot history
    try:
        hist = json.loads(HIST.read_text())
    except Exception:
        hist = []
    hist.append([now, tot_rows, tot_ovr])
    hist = [p for p in hist if now - p[0] <= WINDOW_S * 2]
    HIST.parent.mkdir(exist_ok=True)
    HIST.write_text(json.dumps(hist))
    pts = [p for p in hist if now - p[0] <= WINDOW_S]
    rows_hr = ovr_hr = None
    if len(pts) >= 2 and now - pts[0][0] > 600:
        dt = now - pts[0][0]
        rows_hr = (tot_rows - pts[0][1]) / dt * 3600
        ovr_hr = (tot_ovr - pts[0][2]) / dt * 3600

    # ladder rows
    lrows = []
    for name, mark, why in LADDER:
        pct = min(100.0, tot_rows / mark * 100)
        eta = ((mark - tot_rows) / rows_hr * 3600
               if rows_hr and tot_rows < mark else
               (0 if tot_rows >= mark else None))
        cost = (f"&asymp; ${eta / 86400 * DAILY_COST:.0f} more"
                if eta and eta > 0 else "")
        lrows.append(
            f"<tr class='{'done' if tot_rows >= mark else ''}'>"
            f"<td><b>{name.upper()}</b><br><span class=sub>{why}</span></td>"
            f"<td class=num>{fmt_n(mark)} rows</td>"
            f"<td><span class=bar><span class=fill "
            f"style='width:{pct:.1f}%'></span></span> "
            f"<span class=sub>{pct:.0f}%</span></td>"
            f"<td class=num><b>{fmt_eta(eta)}</b><br>"
            f"<span class=sub>{cost}</span></td></tr>")

    # per-source health
    srows = []
    for key in [f"box{i}" for i, _ in BOXES] + ["mbp"]:
        v = sources.get(key)
        label = key.upper() if key == "mbp" else key
        if v is None:
            srows.append(f"<tr class=bad><td><b>{label}</b></td>"
                         f"<td colspan=6>UNREACHABLE — box down or ssh "
                         f"failing</td></tr>")
            continue
        exp = EXPECTED["mbp" if key == "mbp" else int(key[3:])]
        stale = v.get("_age", 0) > 15 * 60
        streams = v["streams"]
        age = v.get("write_age_s")
        ok = (not stale) and streams == exp and age is not None and age < 900
        health = ("&#128564; asleep / not pushing" if stale else
                  "&#9989; healthy" if ok else
                  f"&#9888;&#65039; check: {streams}/{exp} streams, "
                  f"last write {fmt_eta(age)} ago")
        g = v["mar"]["games"] + v["std"]["games"]
        h = v["mar"]["hands"] + v["std"]["hands"]
        o = v["mar"]["ovr"] + v["std"]["ovr"]
        srows.append(
            f"<tr class='{'bad' if (stale or not ok) else ''}'>"
            f"<td><b>{label}</b></td>"
            f"<td>{health}</td>"
            f"<td class=num>{streams}/{exp}</td>"
            f"<td class=num>{v['mar']['games']:,} + {v['std']['games']:,}"
            f"<span class=sub> std</span></td>"
            f"<td class=num>{h:,}</td>"
            f"<td class=num>{fmt_n(rows_est(v))}</td>"
            f"<td class=num>{fmt_n(o)}</td></tr>")

    prec = (1.96 * math.sqrt(0.25 / duel_g) * 100) if duel_g else 0
    up_days = "" if not rows_hr else (
        f" &middot; adding &asymp;{fmt_n(rows_hr * 24)} rows + "
        f"{fmt_n(ovr_hr * 24)} needles / day")

    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=120>
<title>AlphaRook — t0 corpus</title>
<style>body{{background:#111;color:#ddd;font:14px/1.6 monospace;padding:24px;
max-width:1000px}}
table{{border-collapse:collapse;margin:14px 0;width:100%}}
td,th{{border:1px solid #333;padding:7px 11px;text-align:left;
vertical-align:top}}
th{{background:#1a1a1a;color:#9c9}}
.num{{text-align:right;white-space:nowrap}}
h1{{font-size:19px;margin-bottom:2px}} h2{{font-size:15px;margin:22px 0 0}}
.sub{{color:#888;font-size:12px}}
.big{{font-size:26px;color:#4c4}}
.bar{{background:#222;height:9px;width:180px;display:inline-block;
vertical-align:middle}}
.fill{{background:#4c4;height:9px;display:block}}
tr.done td{{background:#12200f}}
tr.bad td{{background:#251111}}
.hdr{{background:#1a1a10;border:1px solid #553;padding:12px 16px}}
.note{{background:#161616;border:1px solid #2a2a2a;padding:10px 16px;
margin-top:16px;color:#aaa;font-size:12px}}</style></head><body>
<h1>&#127981; T0 CORPUS &mdash; the gen23 teacher bank</h1>
<div style='margin:4px 0'><a href="/train.html" style="color:#5b8bd9">
&#127891; gen23-mimic1 training curves &rarr;</a></div>
<div class=sub>teacher = gen21 &times; belief &times; K24 search from the
opening lead &middot; every game replay-verified into training data
&middot; refreshed {time.strftime('%H:%M UTC', time.gmtime(now))}</div>

<div class=hdr style='margin-top:14px'>
<span class=big>{fmt_n(tot_rows)}</span> teacher rows &nbsp;&middot;&nbsp;
<span class=big>{fmt_n(tot_ovr)}</span> needles
<span class=sub>(exact &mdash; search overrides, the pre-labeled
lessons)</span><br>
<span class=sub>{tot_games:,} games &middot; {tot_hands:,} hands across
{len(live)}/6 machines{up_days}</span></div>

<h2>THE CONVERSION <span class=sub>(games are what you count; rows are
what trains)</span></h2>
<table>
<tr><th>format</th><th class=num>hands / game</th>
<th class=num>teacher rows / game</th><th class=num>needles / game</th></tr>
<tr><td>marathon (2000 / &minus;1000)</td><td class=num>&asymp; 69</td>
<td class=num>&asymp; 1,500</td><td class=num>&asymp; 107</td></tr>
<tr><td>standard (500 / &minus;250)</td><td class=num>&asymp; 13</td>
<td class=num>&asymp; 300</td><td class=num>&asymp; 22</td></tr>
</table>

<h2>THE LADDER <span class=sub>(where training quality lands at each
corpus size)</span></h2>
<table>
<tr><th>grade</th><th class=num>mark</th><th>progress</th>
<th class=num>ETA / cost</th></tr>
{''.join(lrows)}
</table>

<h2>MACHINES</h2>
<table>
<tr><th>source</th><th>health</th><th class=num>streams</th>
<th class=num>games (mar + std)</th><th class=num>hands</th>
<th class=num>rows</th><th class=num>needles</th></tr>
{''.join(srows)}
</table>

<h2>THE MEASUREMENT <span class=sub>(same games, read as a duel)</span></h2>
<div class=note>
gen21+t0 beats bare gen21 in <b>{duel_w / duel_g:.1%}</b> of marathon
games <span class=sub>(n = {duel_g:,} corpus-era games, &plusmn;{prec:.1f}pp
at 95%)</span> &mdash; the pre-registered 1,000-game read is settled;
this number is now just the teacher's credential.<br><br>
<b>Healthy looks like:</b> 23/23 streams, every box &#9989;, last write
under a few minutes. The keepers self-heal within 5 min of any crash;
resume-safe streams skip already-banked pairs. MBP shows &#128564; when
the laptop sleeps &mdash; the fleet doesn't depend on it.</div>
</body></html>"""
    Path("/root/status").mkdir(exist_ok=True)
    Path("/root/status/index.html").write_text(page)


if __name__ == "__main__":
    main()
