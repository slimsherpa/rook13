#!/usr/bin/env python3
"""PROJECT ALPHAROOK dashboard — the K-ladder grind, live.

Reads the pulled duel dumps (runs/gen24/mrook*_duel.jsonl) and probe
shards, emits a single self-contained HTML page. The MBP updater loop
pulls from the fleet, runs this, and pushes the page to the hub box's
:8080 (the same address the evo-era dashboard lived at).

Usage: alpharook_dash.py > index.html
"""
import glob
import json
import statistics as st
import subprocess
import sys
import time

ARMS = [
    (48, ["runs/gen24/mrook48_duel.jsonl"], "runs/gen24/mrook48_duel.log"),
    (96, ["runs/gen24/mrook96_duel.jsonl"], "runs/gen24/mrook96_duel.log"),
    (192, ["runs/gen24/mrook192_duel.jsonl"],
     "runs/gen24/mrook192_duel.log"),
    (384, ["runs/gen24/mrook384_duel.jsonl",
           "runs/gen24/mrook384b_duel.jsonl"],
     "runs/gen24/mrook384_duel.log"),
    (768, ["runs/gen24/mrook768_duel.jsonl"],
     "runs/gen24/mrook768_duel.log"),
]


def arm_stats(paths):
    if isinstance(paths, str):
        paths = [paths]
    R = []
    for path in paths:
        try:
            R += [json.loads(l) for l in open(path) if l.strip()]
        except FileNotFoundError:
            continue
    if not R:
        return None
    games = len(R)
    hands = sum(r["hands"] for r in R)
    wins = sum(1 for r in R if r["w"] == 0)
    pts = [h[3] for r in R for h in r["hh"]]
    se = st.pstdev(pts) / max(len(pts), 1) ** 0.5
    am = sum(r["a_made"] for r in R)
    ac = sum(r["a_contracts"] for r in R)
    bm = sum(r["b_made"] for r in R)
    bc = sum(r["b_contracts"] for r in R)
    # Riley's cliff-free view (2026-08-05): RAW captured points, split by
    # role, derived exactly from (decl, bid, made, delta) — verified 0
    # violations on 24k hands. Strips the -bid cliff out of the story.
    mr_decl, mr_def, cos_decl, cos_def = [], [], [], []
    for r in R:
        for decl, bid, made, delta in r["hh"]:
            d = delta if decl == 0 else -delta
            if made:
                pd = (d + 120) / 2
            else:
                pd = 120 - (-bid - d)
            pf = 120 - pd
            if decl == 0:
                mr_decl.append(pd)
                cos_def.append(pf)
            else:
                cos_decl.append(pd)
                mr_def.append(pf)
    return dict(games=games, hands=hands, win=wins / games,
                pts=st.mean(pts), ci=1.96 * se,
                mr_make=am / max(ac, 1), cos_make=bm / max(bc, 1),
                mr_decl=st.mean(mr_decl) if mr_decl else 0,
                cos_decl=st.mean(cos_decl) if cos_decl else 0,
                mr_def=st.mean(mr_def) if mr_def else 0,
                cos_def=st.mean(cos_def) if cos_def else 0)


def pace(logpath):
    try:
        line = subprocess.run(["tail", "-1", logpath], capture_output=True,
                              text=True).stdout.strip()
    except Exception:
        return ""
    return line


def main():
    rows = []
    for k, dump, log in ARMS:
        s = arm_stats(dump)
        p = pace(log)
        spg = ""
        if "s/game" in p:
            spg = p.split(",")[-1].strip()
        if s:
            sig = "✅" if s["pts"] - s["ci"] > 0 else \
                  ("❌" if s["pts"] + s["ci"] < 0 else "…")
            rows.append(
                f"<tr><td>K{k}</td><td>{s['games']}</td>"
                f"<td>{s['hands']:,}</td><td>{spg}</td>"
                f"<td><b>{s['pts']:+.1f}</b> ± {s['ci']:.1f} {sig}</td>"
                f"<td>{s['win']:.1%}</td>"
                f"<td>{s['mr_make']:.0%} vs {s['cos_make']:.0%}</td>"
                f"<td>{s['mr_decl']:.1f} vs {s['cos_decl']:.1f}</td>"
                f"<td>{s['mr_def']:.1f} vs {s['cos_def']:.1f}</td></tr>")
        else:
            rows.append(f"<tr><td>K{k}</td><td colspan=8>warming up…"
                        f" {p}</td></tr>")

    # inline SVG: THE CURVE — K (log2 x-axis) vs pts/hand, CI whiskers.
    # This is the seed of Riley's end-of-experiment artifact: the
    # MortalGodAlphaRook saturation curve.
    pts_rows = []
    for k, dump, _ in ARMS:
        s = arm_stats(dump)
        if s and s["hands"] > 200:
            pts_rows.append((k, s["pts"], s["ci"]))
    svg = ""
    if len(pts_rows) >= 2:
        import math
        W, H, PAD = 640, 260, 45
        ks = [math.log2(k) for k, _, _ in pts_rows]
        los = [p - c for _, p, c in pts_rows]
        his = [p + c for _, p, c in pts_rows]
        ymin, ymax = min(min(los), 0) - 1, max(his) + 1
        def X(lk): return PAD + (lk - ks[0]) / max(ks[-1] - ks[0], 1) * (W - 2 * PAD)
        def Y(v): return H - PAD - (v - ymin) / (ymax - ymin) * (H - 2 * PAD)
        parts = [f'<svg width="{W}" height="{H}" style="background:#161b22;'
                 f'border:1px solid #30363d">']
        zy = Y(0)
        parts.append(f'<line x1="{PAD}" y1="{zy}" x2="{W-PAD}" y2="{zy}" '
                     f'stroke="#8b949e" stroke-dasharray="4"/>')
        parts.append(f'<text x="{W-PAD+4}" y="{zy+4}" fill="#8b949e" '
                     f'font-size="11">Cosmo</text>')
        pline = []
        for (k, p, c) in pts_rows:
            x, y = X(math.log2(k)), Y(p)
            parts.append(f'<line x1="{x}" y1="{Y(p-c)}" x2="{x}" '
                         f'y2="{Y(p+c)}" stroke="#79c0ff" stroke-width="2"/>')
            parts.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#f0b429"/>')
            parts.append(f'<text x="{x-10}" y="{H-PAD+16}" fill="#e6edf3" '
                         f'font-size="12">K{k}</text>')
            pline.append(f"{x},{y}")
        parts.append(f'<polyline points="{" ".join(pline)}" fill="none" '
                     f'stroke="#f0b429" stroke-width="1.5" opacity="0.6"/>')
        parts.append(f'<text x="{PAD}" y="18" fill="#79c0ff" font-size="13">'
                     f'pts/hand vs Cosmo — whiskers are 95% CI; more compute '
                     f'tightens them</text></svg>')
        svg = "".join(parts)
    curve = "K12 +1.7 · K24 +2.0 · K48 +2.6 · K96 +3.9 (pts/early-decision)"
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="120">
<title>PROJECT ALPHAROOK</title>
<style>
body{{font-family:ui-monospace,Menlo,monospace;background:#0d1117;
color:#e6edf3;margin:2rem}}
h1{{color:#f0b429}} h2{{color:#79c0ff;margin-top:2rem}}
table{{border-collapse:collapse;margin-top:1rem}}
td,th{{border:1px solid #30363d;padding:.5rem .9rem;text-align:right}}
th{{background:#161b22;color:#79c0ff}}
.small{{color:#8b949e;font-size:.85rem}}
</style></head><body>
<h1>PROJECT ALPHAROOK — the K-ladder, live</h1>
<p class=small>MortalRook (disciplined exact-solve mortal) vs Cosmo
(gen21×belief×t0 K24) · duplicate decks · family format · per-hand
currency. Positive pts/hand = MortalRook ahead. ✅ = CI clear of zero.
Updated {time.strftime('%Y-%m-%d %H:%M:%S %Z')}</p>
<table><tr><th>arm</th><th>games</th><th>hands</th><th>pace</th>
<th>pts/hand vs Cosmo</th><th>game win%</th><th>make% MR vs Cosmo</th>
<th>declaring: pts captured</th><th>defending: pts captured</th></tr>
{''.join(rows)}</table>
<h2>THE CURVE — compute vs strength (the saturation hunt)</h2>
{svg or '<p class=small>appears once two arms pass 200 hands</p>'}
<h2>column guide</h2>
<p class=small>
<b>arm</b>: K = imagined deals MortalRook averages before playing a card ·
<b>games</b>: full games to 500/−250, every deck played twice with teams
swapped so deal luck cancels ·
<b>hands</b>: total deals inside those games — one data point each ·
<b>pace</b>: wall-clock seconds per game per fleet core ·
<b>pts/hand vs Cosmo</b>: PER HAND (a hand = one deal, 9 tricks): each
hand's scorecard delta for MortalRook's team minus Cosmo's team (made
contract = points captured; set = −bid), averaged. ± is the 95%%
confidence range; ✅ = range clear of zero ·
<b>game win%%</b>: share of full games won ·
<b>make%%</b>: of contracts each side bought, share converted — same
bidding brains both sides, so any difference is pure card play ·
<b>declaring/defending pts captured</b>: RAW points won at the table
(out of 120/hand incl. the 20 trick bonus), no −bid cliff anywhere —
"when MY team bought the contract, I captured X; when THEIRS did, I
stole Y." MR's number vs Cosmo's number in the same role. The cliff-free
view of the same skill the pts/hand column prices.</p>
<h2>think-time per decision (measured 08-05, 1 MBP core; ×2 for a
fleet/cloud core, ÷cores when worlds are parallelized)</h2>
<table><tr><th>K</th><th>t0 LEAD med/p90</th><th>t0 follow</th>
<th>trick 1</th><th>trick 4+</th></tr>
<tr><td>48</td><td>25.7s / 42s</td><td>3.3s</td><td>1.2s</td><td>0.02s</td></tr>
<tr><td>96</td><td>51.8s / 85s</td><td>5.4s</td><td>1.7s</td><td>0.03s</td></tr>
<tr><td>192</td><td>82.1s / 154s</td><td>11.9s</td><td>3.6s</td><td>0.05s</td></tr>
<tr><td>384</td><td>227.7s / 478s</td><td>26.8s</td><td>7.8s</td><td>0.10s</td></tr></table>
<p class=small>The OPENING LEAD is the wall — ~8× any other trick-0
decision, ~1000× the late tricks. Production implication: budget-shaped
K (8s at 8 cores ≈ K50–64 on the lead, K200+ on follows, unlimited
late) rather than flat K.</p>
<h2>the scouting quiz that aimed these duels (8.2k flashcards)</h2>
<p class=small>Before the duels we ran flashcards: freeze one moment of
a real game, ask "what card?", grade that single answer with perfect
math on fresh imagined deals, put the game back. Those grades —
{curve} — measured points gained PER GRADED EARLY DECISION (~5 such
decisions per hand per team), not per hand. They drew the map: gain
grows with K, cost is linear. The duel table above is the territory —
whole hands, consequences included, in the per-hand currency.</p>
<p class=small>C solver: 58–66× Python, parity-proven both platforms.
8-second budget at 8 cores ≈ K50 hard-case / K400 median on the opening
lead. Fleet: 3× CPX51 + MBP.</p>
</body></html>"""
    sys.stdout.write(html)


if __name__ == "__main__":
    main()
