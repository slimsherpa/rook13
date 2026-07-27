#!/usr/bin/env python3
"""Live ETA board for the three teacher matchups. Cron on hil-1 every 2
min; writes /root/status/index.html, served by the existing :8080.

Deliberately shows PROGRESS ONLY — no win rates. The three runs have a
pre-registered read at 1,000 games each, and a dashboard that displays a
running score turns every glance into an optional-stopping decision. That
is the exact mechanism behind the nine mirages. Flip SHOW_SCORES if you
decide you want to look; it is one line and it is Riley's call, not the
dashboard's.

Rates come from a rolling snapshot history on disk, since the duel dumps
carry no timestamps — one line per finished game is all they hold.
"""
import json
import math
import subprocess
import time
from pathlib import Path

SHOW_SCORES = True
TARGET = 2000   # t0 is best-effort: take as many as the clock allows
HIST = Path("/root/status/duel_hist.json")
WINDOW_S = 45 * 60          # rate is measured over this trailing window

BOXES = [(1, None), (2, "5.78.130.139"), (3, "5.78.128.203"),
         (4, "5.78.135.83"), (5, "5.78.145.180")]
MATCHUPS = [
    ("gen21 vs t0", "g21_vs_t0_box{i}*.jsonl",
     "THE LIVE QUESTION — t0 is the only gate that searches the opening "
     "lead. Every game also recorded as teacher corpus."),
    ("gen21 vs t0 — standard slice", "g21_vs_t0_std_box{i}.jsonl",
     "500/−250 corpus slice (boxes 4-5 + Riley's MBP, ~13% of streams): "
     "covers the hand_number range and near-threshold score states the "
     "marathon format under-samples."),
    ("t1 vs t3", "t1m_box{i}*.jsonl",
     "SETTLED: t1 wins 53.9% (p=0.007) but costs 1.47x per needle"),
    ("gen21 vs t3", "g21_vs_t3_box{i}*.jsonl",
     "SETTLED: the rung the current teacher offers"),
    ("gen21 vs t1", "g21_vs_t1_box{i}*.jsonl",
     "SETTLED: 74.9% vs gen21 &mdash; indistinguishable from t3, so t1 "
     "buys nothing where it counts"),
]


def shell(ip, cmd):
    if ip is None:
        return subprocess.run(["bash", "-c", cmd], capture_output=True,
                              text=True, timeout=60).stdout
    return subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
         f"root@{ip}", cmd], capture_output=True, text=True,
        timeout=60).stdout


def collect():
    """(games, hands, wins_a) per matchup across the fleet."""
    out = {}
    for name, pat, _why in MATCHUPS:
        games = hands = wins = 0
        for i, ip in BOXES:
            f = "/root/rook13/ml/runs/" + pat.format(i=i)
            raw = shell(ip, f"cat {f} 2>/dev/null")
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                games += 1
                hands += r.get("hands", 0)
                wins += (r.get("w") == 0)
        out[name] = (games, hands, wins)
    return out


def load_hist():
    try:
        return json.loads(HIST.read_text())
    except Exception:
        return {}


MIN_SPAN_S = 600      # a rate from a 38s window is noise wearing a decimal
MIN_GAMES = 8


def rate_for(hist, name, games, hands, now):
    """(games/hr, sec per game, sec per hand) from the trailing window.

    Returns None until the window is actually long enough to mean
    something. A short sample gives a confident-looking number that is
    pure noise — the same failure mode as reading a duel at 50 pairs.
    """
    pts = [p for p in hist.get(name, []) if now - p[0] <= WINDOW_S]
    if len(pts) < 2:
        return None, None, None
    t0, g0, h0 = pts[0]
    dt, dg, dh = now - t0, games - g0, hands - h0
    if dt < MIN_SPAN_S or dg < MIN_GAMES:
        return None, None, None
    return dg / dt * 3600, dt / dg, (dt / dh if dh > 0 else None)


def fmt_eta(secs):
    if secs is None:
        return "—"
    if secs < 90:
        return f"{secs:.0f}s"
    if secs < 5400:
        return f"{secs / 60:.0f} min"
    return f"{secs / 3600:.1f} hr"


def main():
    now = time.time()
    data = collect()
    hist = load_hist()
    rows = []
    all_eta = []

    for name, _pat, why in MATCHUPS:
        games, hands, wins = data[name]
        hist.setdefault(name, []).append([now, games, hands])
        hist[name] = [p for p in hist[name] if now - p[0] <= WINDOW_S * 2]

        gph, spg, sph = rate_for(hist, name, games, hands, now)
        left = max(0, TARGET - games)
        eta = (left / gph * 3600) if (gph and gph > 0) else None
        if left > 0:
            all_eta.append(eta if eta is not None else float("inf"))
        pct = min(100.0, games / TARGET * 100)
        hpg = hands / games if games else 0
        done = games >= TARGET

        prec = ("<span class=sub>&mdash;</span>" if games < 30 else
                f"&plusmn;{1.96 * math.sqrt(0.25 / games) * 100:.1f}pp"
                + (f"<br><span class=sub>sees {50 + 1.64 * math.sqrt(0.25 / games) * 100:.1f}%+</span>"))
        score = ""
        if SHOW_SCORES and games:
            score = f"<td><b>{wins / games:.1%}</b></td>"
        elif SHOW_SCORES:
            score = "<td>—</td>"

        rows.append(f"""<tr class='{"done" if done else ""}'>
<td><b>{name}</b><br><span class=sub>{why}</span></td>
<td class=num>{games:,}<span class=sub> / {TARGET:,}</span><br>
<span class=bar><span class=fill style='width:{pct:.1f}%'></span></span>
<span class=sub> {pct:.1f}%</span></td>
<td class=num>{hands:,}<br><span class=sub>{hpg:.1f}/game</span></td>
<td class=num>{f"{sph:.2f}s" if sph else "<span class=sub>measuring…</span>"}</td>
<td class=num>{f"{spg:.0f}s" if spg else "<span class=sub>measuring…</span>"}</td>
<td class=num>{f"{gph:.0f}" if gph else "<span class=sub>measuring…</span>"}</td>
<td class=num>{prec}</td>
<td class=num><b>{"&#10003; DONE" if done else fmt_eta(eta)}</b></td>
{score}</tr>""")

    HIST.parent.mkdir(exist_ok=True)
    HIST.write_text(json.dumps(hist))

    finite = [e for e in all_eta if e not in (None, float("inf"))]
    overall = max(finite) if finite else None
    tot_g = sum(v[0] for v in data.values())
    tot_h = sum(v[1] for v in data.values())
    eta_clock = (time.strftime('%H:%M UTC', time.gmtime(now + overall))
                 if overall else "—")

    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=60>
<title>AlphaRook — teacher matchups</title>
<style>body{{background:#111;color:#ddd;font:14px/1.6 monospace;padding:24px;
max-width:1100px}}
table{{border-collapse:collapse;margin:14px 0;width:100%}}
td,th{{border:1px solid #333;padding:7px 11px;text-align:left;
vertical-align:top}}
th{{background:#1a1a1a;color:#9c9}}
.num{{text-align:right;white-space:nowrap}}
h1{{font-size:19px;margin-bottom:2px}}
.sub{{color:#888;font-size:12px}}
.bar{{background:#222;height:9px;width:150px;display:inline-block;
vertical-align:middle}}
.fill{{background:#4c4;height:9px;display:block}}
tr.done td{{background:#12200f}}
.hdr{{background:#1a1a10;border:1px solid #553;padding:10px 16px}}
.note{{background:#161616;border:1px solid #2a2a2a;padding:10px 16px;
margin-top:16px;color:#aaa;font-size:12px}}</style></head><body>
<h1>&#9878; TEACHER MATCHUPS — marathon (2000 / &minus;1000)</h1>
<div class=sub>duplicate decks, seats swapped &middot; every deal played
twice so both sides hold the same cards</div>

<div class=hdr style='margin-top:14px'>
<b>ALL {len(MATCHUPS)} ARMS DONE IN &asymp; {fmt_eta(overall)}</b>
&nbsp;<span class=sub>(&asymp; {eta_clock})</span><br>
<span class=sub>{tot_g:,} games &middot; {tot_h:,} hands played so far
&middot; refreshed {time.strftime('%H:%M:%S UTC', time.gmtime(now))},
auto-reloads every 60s</span></div>

<table>
<tr><th>matchup</th><th class=num>games</th><th class=num>hands</th>
<th class=num>sec / hand</th><th class=num>sec / game</th>
<th class=num>games / hr</th><th class=num>precision</th>
<th class=num>ETA</th>
{"<th>A win%</th>" if SHOW_SCORES else ""}</tr>
{''.join(rows)}
</table>

<div class=note>
<b>Scores are hidden on purpose.</b> The three head-to-head arms have a
pre-registered read at {TARGET:,} games; <b>gen21 vs t0 is best-effort</b>
&mdash; take what the clock allows and read it with its own error bar. A board that shows a live win rate turns every
glance into a stopping decision — check often enough and something will
look significant that isn't. That is exactly how the nine mirages
happened. Flip <code>SHOW_SCORES</code> in
<code>/root/duel_status.py</code> whenever you want to look; it is your
call, not the dashboard's.<br><br>
<b>precision</b> = the 95% band a result would carry at the current game
count, and the smallest edge that would clear significance. It tells you
how sharp the answer is <i>without telling you what it is</i> — so you can
judge when revealing is worth it.<br><br>
<b>sec/hand</b> is fleet-effective (wall time &divide; hands finished
across all boxes), so it already accounts for the workers running in
parallel. Rates are measured over a trailing 45 min, so they settle a few
minutes after any run starts or is rebalanced.<br><br>
<b>Decision rule</b> (set before any result was seen) &mdash;
&ge;55%: trick-1 is a real rung, switch the teacher &middot; 52&ndash;55%:
under-powered, extend rather than guess &middot; &lt;52%: trick-3 stays.
</div>
</body></html>"""
    Path("/root/status").mkdir(exist_ok=True)
    Path("/root/status/index.html").write_text(page)


if __name__ == "__main__":
    main()
