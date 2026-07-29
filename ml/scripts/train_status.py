#!/usr/bin/env python3
"""Training-curve page — http://5.78.115.122:8080/train.html

Cron on the hub every 2 min. Renders gen23-mimic1's quiz history from
runs/gen23-mimic1/log.jsonl as inline SVG (no JS, auto-refresh meta tag).

The metric that matters is match_ovr — the share of held-out NEEDLES
(moments where the teacher's search overrode the gen21 reflex) that the
student now gets right. gen21 itself scores ~0% there by construction.
Banking: best.pt = highest match_ovr with bid fidelity >= 95%; the quiz
picks the checkpoint, the DUEL decides whether it ships.
"""
import json
import time
from pathlib import Path

RUN = Path("/root/rook13/ml/runs/gen23-mimic1")
OUT = Path("/root/status/train.html")
TOTAL_STEPS = 120000


def poly(pts, xmap, ymap, color, width=2.5, dash=""):
    d = " ".join(f"{xmap(x):.1f},{ymap(y):.1f}" for x, y in pts)
    dash = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<polyline points="{d}" fill="none" stroke="{color}" '
            f'stroke-width="{width}" stroke-linejoin="round"{dash}/>')


def main():
    rows = []
    try:
        for line in open(RUN / "log.jsonl"):
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    if not rows:
        return
    now = time.time()
    last = rows[-1]
    step = last["step"]
    done = step >= TOTAL_STEPS - 2000
    rps = last.get("rows_per_sec") or 1
    steps_s = rps / 512.0
    eta_s = max(0, (TOTAL_STEPS - step) / steps_s) if not done else 0

    # banked best under the gate
    gated = [r for r in rows if r.get("match_bid", 0) >= 0.95]
    best = max(gated, key=lambda r: r.get("match_ovr", 0)) if gated else None

    X0, X1, Y0, Y1 = 70, 860, 30, 300          # plot box
    xmap = lambda s: X0 + (X1 - X0) * s / TOTAL_STEPS
    pct = lambda v: Y1 - (Y1 - Y0) * v          # 0..1 -> px

    ovr = [(r["step"], r["match_ovr"]) for r in rows]
    bid = [(r["step"], r["match_bid"]) for r in rows]
    play = [(r["step"], r["match_play"]) for r in rows]
    vls = [(r["step"], r["val_loss"]) for r in rows]
    vmax = max(v for _, v in vls)
    vmap = lambda v: Y1 - (Y1 - Y0) * (v / vmax)

    grid = ""
    for p in (0, .25, .5, .75, 1.0):
        y = pct(p)
        grid += (f'<line x1="{X0}" y1="{y}" x2="{X1}" y2="{y}" '
                 f'stroke="#232a3a" stroke-dasharray="3 3"/>'
                 f'<text x="{X0-8}" y="{y+4}" text-anchor="end" '
                 f'font-size="11" fill="#98a0b0">{p:.0%}</text>')
    for s in range(0, TOTAL_STEPS + 1, 20000):
        x = xmap(s)
        grid += (f'<text x="{x}" y="{Y1+18}" text-anchor="middle" '
                 f'font-size="11" fill="#98a0b0">{s//1000}k</text>')

    star = ""
    if best:
        bx, by = xmap(best["step"]), pct(best["match_ovr"])
        star = (f'<circle cx="{bx}" cy="{by}" r="6" fill="none" '
                f'stroke="#dbaa3d" stroke-width="2.5"/>'
                f'<text x="{bx+10}" y="{by-8}" font-size="11" fill="#dbaa3d">'
                f'banked: {best["match_ovr"]:.1%} @ {best["step"]//1000}k</text>')

    status = ("&#127937; FINISHED — candidate checkpoint banked" if done else
              f"step {step:,} / {TOTAL_STEPS:,} &middot; "
              f"&asymp;{eta_s/3600:.1f} h left &middot; {rps:,.0f} rows/s")

    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=120>
<title>gen23-mimic1 — training</title>
<style>body{{background:#11151f;color:#e4e6ec;font:14px/1.6 monospace;
padding:24px;max-width:960px;margin:0 auto}}
h1{{font-size:19px;margin-bottom:2px}} .sub{{color:#98a0b0;font-size:12px}}
.hdr{{background:#181d2a;border:1px solid #2a3140;padding:12px 16px;
margin:14px 0}}
.note{{background:#161b28;border:1px solid #2a3140;padding:10px 16px;
margin-top:16px;color:#98a0b0;font-size:12px;line-height:1.7}}
a{{color:#5b8bd9}}</style></head><body>
<h1>&#127891; gen23-mimic1 — the student's report card</h1>
<div class=sub>warm-started from gen21 &middot; cloning the t0 teacher's
54M decisions &middot; refreshed {time.strftime('%H:%M UTC', time.gmtime(now))}
&middot; <a href="/">back to corpus board</a></div>

<div class=hdr><b>{status}</b><br>
<span class=sub>quiz = 494k held-out rows from 400 games the student never
trains on &middot; banking best.pt by needle-match, gated on bid fidelity
&ge; 95%</span></div>

<svg viewBox="0 0 880 340" style="width:100%;height:auto">
{grid}
{poly(vls, xmap, vmap, "#3a4358", 2, "5 4")}
{poly(play, xmap, pct, "#4aa375")}
{poly(bid, xmap, pct, "#5b8bd9")}
{poly(ovr, xmap, pct, "#dbaa3d", 3)}
{star}
<text x="{X1-4}" y="{pct(bid[-1][1])-8}" text-anchor="end" font-size="12"
 fill="#5b8bd9">bid fidelity {bid[-1][1]:.1%}</text>
<text x="{X1-4}" y="{pct(play[-1][1])+16}" text-anchor="end" font-size="12"
 fill="#4aa375">play match {play[-1][1]:.1%}</text>
<text x="{X1-4}" y="{pct(ovr[-1][1])-10}" text-anchor="end" font-size="12"
 fill="#dbaa3d" font-weight="700">NEEDLES {ovr[-1][1]:.1%}</text>
<text x="{X1-4}" y="{vmap(vls[-1][1])-8}" text-anchor="end" font-size="11"
 fill="#5c6472">val loss {vls[-1][1]:.3f} (own scale)</text>
</svg>

<div class=note>
<b>How to read this.</b> The gold line is the one to watch: of the held-out
moments where the teacher's search <i>disagreed</i> with the gen21 reflex,
how many does the student now play the teacher's way? gen21 scores ~0% here
by definition — every point is absorbed search-skill. It jumped to ~21% in
the first 2,000 steps and has been consolidating since; much of the
remaining 80% is search breaking near-ties (two equal cards, a coin-flip
preference), which no reflex can or should memorize. Blue must stay
&ge; 95% — a student that buys needle-match by wrecking its bidding is
worse, not better (the mimic1-a lesson). The dashed line is validation
loss, still falling: the student keeps getting <i>more confident</i> in the
teacher's choices even where its top pick stopped changing.<br><br>
<b>The finish is fixed, not vibes:</b> the run stops at 120k steps
(~{TOTAL_STEPS*512/1e6:.0f}M rows &asymp; one pass over the corpus). The
banked checkpoint (&#11088;) then faces fresh-seed sprint + marathon duels
vs gen13, gen16 and gen21 — the quiz picks the candidate, only the duel can
crown it.</div>
</body></html>"""
    OUT.write_text(page)


if __name__ == "__main__":
    main()
