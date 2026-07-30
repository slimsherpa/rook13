#!/usr/bin/env python3
"""Render the gauntlet artifact: Riley's hand-sketch, 18 times, from data.

Per matchup card: win donut, final-score distribution (paired bars),
winning-bid distribution, make-vs-set stacked bars by bid, averages.
Sprints first, marathons second. Same visual identity as 'The 48-Hour
Match' (rook blue / slate / red / green / gold, scorecard sans).
"""
import json
import math

SRC = "/private/tmp/claude-501/-Users-rileyadamson-Documents-GitHub-rook13/1516f93a-98f5-40df-88de-20c61166b2cd/scratchpad/gauntlet_report.json"
OUT = "/private/tmp/claude-501/-Users-rileyadamson-Documents-GitHub-rook13/1516f93a-98f5-40df-88de-20c61166b2cd/scratchpad/gen23-gauntlet.html"

R = json.load(open(SRC))

OPPONENTS = [
    ("teacher", "gen21+t0 · The Teacher",
     "the K24 opening-lead searcher gen23 was cloned from"),
    ("gen21", "gen21", "the donor — gen23 started as its byte-copy"),
    ("cosmo", "gen19 · Cosmo", "production top pick — belief + K8 search"),
    ("cougar", "gen16 · Cougar", "production — belief + K8 search t5"),
    ("gen13", "gen13 · Puma", "production reflex — the belief net"),
    ("gen11", "gen11 · Cub", "production — gen10 + K8 search"),
    ("gen10", "gen10 · Bobcat", "production reflex"),
    ("gen9", "gen9 · Kitten", "first fully-neural champion"),
    ("gen8", "gen8 · Stomper", "production reflex"),
]
KEYS = {
    ("teacher", "s"): ["gauntlet_teacher_sprint"],
    ("teacher", "m"): ["gauntlet_teacher_marathon"],
    ("gen21", "s"): ["gauntlet_gen21_sprint2", "screen_latest_sprint"],
    ("gen21", "m"): ["gauntlet_gen21_marathon2", "screen_latest_marathon"],
    ("cosmo", "s"): ["gauntlet_cosmo_sprint"],
    ("cosmo", "m"): ["gauntlet_cosmo_marathon"],
    ("cougar", "s"): ["gauntlet_cougar_sprint"],
    ("cougar", "m"): ["gauntlet_cougar_marathon"],
    ("gen13", "s"): ["gauntlet_gen13_sprint"],
    ("gen13", "m"): ["gauntlet_gen13_marathon"],
    ("gen11", "s"): ["gauntlet_gen11_sprint"],
    ("gen11", "m"): ["gauntlet_gen11_marathon"],
    ("gen10", "s"): ["gauntlet_gen10_sprint"],
    ("gen10", "m"): ["gauntlet_gen10_marathon"],
    ("gen9", "s"): ["gauntlet_gen9_sprint"],
    ("gen9", "m"): ["gauntlet_gen9_marathon"],
    ("gen8", "s"): ["gauntlet_gen8_sprint"],
    ("gen8", "m"): ["gauntlet_gen8_marathon"],
}


def pool(keys):
    """Merge matchup packs (used to fold replication batteries in)."""
    ms = [R[k] for k in keys if k in R]
    if not ms:
        return None
    if len(ms) == 1:
        return dict(ms[0])
    t = dict(n=0, hands=0, sweeps_a=0, sweeps_b=0, pairs=0)
    wa = 0
    hist = {"A": {}, "B": {}}
    bids = {"A": {}, "B": {}}
    ssum = {"A": 0, "B": 0}
    for m in ms:
        for k in ("n", "hands", "sweeps_a", "sweeps_b", "pairs"):
            t[k] += m[k]
        wa += m["win"] / 100 * m["n"]
        for s in "AB":
            ssum[s] += m["avg"][s] * m["n"]
            for b, c in m["hist"][s].items():
                hist[s][int(b)] = hist[s].get(int(b), 0) + c
            for b, d in m[f"bids_{s}"].items():
                e = bids[s].setdefault(int(b), dict(c=0, set=0))
                e["c"] += d["c"]
                e["set"] += d["set"]
    t["win"] = round(wa / t["n"] * 100, 1)
    t["avg"] = {s: round(ssum[s] / t["n"]) for s in "AB"}
    t["hist"] = {s: dict(sorted(hist[s].items())) for s in "AB"}
    for s in "AB":
        tot = sum(d["c"] for d in bids[s].values())
        t[f"bids_{s}"] = {b: bids[s][b] for b in sorted(bids[s])}
        t[f"contracts_{s}"] = tot
        t[f"set_{s}"] = round(sum(d["set"] for d in bids[s].values())
                              / tot * 100, 1)
        t[f"avg_bid_{s}"] = round(sum(b * d["c"]
                                      for b, d in bids[s].items()) / tot, 1)
    return t


def donut(win):
    """Win-share donut, gen23 = rook blue."""
    rr = 44
    c = 2 * math.pi * rr
    a = c * win / 100
    return (f'<svg viewBox="0 0 120 120" class="donut">'
            f'<circle cx="60" cy="60" r="{rr}" fill="none" '
            f'stroke="var(--slate)" stroke-width="18"/>'
            f'<circle cx="60" cy="60" r="{rr}" fill="none" '
            f'stroke="var(--rook)" stroke-width="18" '
            f'stroke-dasharray="{a:.1f} {c - a:.1f}" '
            f'stroke-dashoffset="{c / 4:.1f}"/>'
            f'<text x="60" y="57" text-anchor="middle" class="dv">'
            f'{win:.1f}%</text>'
            f'<text x="60" y="74" text-anchor="middle" class="ds">gen23'
            f'</text></svg>')


def rebin(hist, width):
    out = {}
    for b, c in hist.items():
        k = int(b) // width * width
        out[k] = out.get(k, 0) + c
    return out


def score_chart(m, fmt):
    width = 125 if fmt == "s" else 250
    ha = rebin(m["hist"]["A"], width)
    hb = rebin(m["hist"]["B"], width)
    buckets = sorted(set(ha) | set(hb))
    n = m["n"]
    W = 640
    bw = max(10, min(30, (W - 60) // max(1, len(buckets)) // 2 - 2))
    peak = max(max(ha.values(), default=1), max(hb.values(), default=1)) / n
    parts = []
    x = 40
    for b in buckets:
        va = ha.get(b, 0) / n / peak * 100
        vb = hb.get(b, 0) / n / peak * 100
        parts.append(
            f'<g transform="translate({x},0)">'
            f'<rect x="0" y="{110 - va:.0f}" width="{bw}" height="{va:.0f}"'
            f' fill="var(--rook)"/>'
            f'<rect x="{bw + 2}" y="{110 - vb:.0f}" width="{bw}" '
            f'height="{vb:.0f}" fill="var(--slate)"/>'
            f'<text x="{bw}" y="124" text-anchor="middle" class="tk">'
            f'{b}</text></g>')
        x += bw * 2 + 12
    return (f'<svg viewBox="0 0 {max(W, x + 20)} 130" class="chart">'
            f'<line x1="30" y1="110" x2="{x}" y2="110" '
            f'stroke="var(--rule)"/>{"".join(parts)}</svg>')


def bid_chart(m):
    """Winning-bid distribution + make-vs-set stacked, per side."""
    bids = sorted(set(m["bids_A"]) | set(m["bids_B"]),
                  key=lambda b: int(b))
    bids = [b for b in bids
            if (m["bids_A"].get(b, m["bids_A"].get(str(b), {"c": 0}))["c"]
                + m["bids_B"].get(b, m["bids_B"].get(str(b), {"c": 0}))["c"])
            > m["n"] * 0.02]
    tot = {s: max(1, m[f"contracts_{s}"]) for s in "AB"}
    parts = []
    x = 46
    for b in bids:
        da = m["bids_A"].get(b) or m["bids_A"].get(str(b)) or {"c": 0,
                                                               "set": 0}
        db = m["bids_B"].get(b) or m["bids_B"].get(str(b)) or {"c": 0,
                                                               "set": 0}
        for i, (d, t, cm, cs) in enumerate((
                (da, tot["A"], "var(--rook)", "var(--red)"),
                (db, tot["B"], "var(--slate)", "var(--red)"))):
            share = d["c"] / t
            h = share * 150
            sh = h * (d["set"] / d["c"]) if d["c"] else 0
            xo = x + i * 26
            parts.append(
                f'<rect x="{xo}" y="{120 - h:.0f}" width="22" '
                f'height="{max(0, h - sh):.0f}" fill="{cm}"/>'
                f'<rect x="{xo}" y="{120 - sh:.0f}" width="22" '
                f'height="{sh:.0f}" fill="{cs}" opacity="{0.95 - i * 0.25}"/>')
            if d["c"] > 20:
                pct = d["set"] / d["c"] * 100
                parts.append(f'<text x="{xo + 11}" y="{116 - h:.0f}" '
                             f'text-anchor="middle" class="tk">'
                             f'{pct:.0f}%</text>')
        parts.append(f'<text x="{x + 26}" y="134" text-anchor="middle" '
                     f'class="tkb">{b}</text>')
        x += 76
    return (f'<svg viewBox="0 0 {max(560, x)} 140" class="chart">'
            f'<line x1="30" y1="120" x2="{x - 10}" y2="120" '
            f'stroke="var(--rule)"/>{"".join(parts)}</svg>')


def card(slug, name, sub, fmt):
    m = pool(KEYS[(slug, fmt)])
    if not m:
        return ""
    prec = 1.96 * math.sqrt(0.25 / m["n"]) * 100
    verdict = ("wins" if m["win"] - prec > 50 else
               "loses" if m["win"] + prec < 50 else "even")
    vcls = {"wins": "vw", "loses": "vl", "even": "ve"}[verdict]
    return f"""
<div class="mcard">
  <div class="mhead">
    <div><div class="mname">gen23 vs {name}</div>
    <div class="msub">{sub} &middot; {m['n']:,} games &middot;
    {m['hands']:,} hands</div></div>
    <div class="verdict {vcls}">{verdict.upper()}</div>
  </div>
  <div class="mbody">
    <div class="mleft">{donut(m['win'])}
      <div class="mstats">
        <div><span>avg final</span><b>{m['avg']['A']:,} :
          {m['avg']['B']:,}</b></div>
        <div><span>sweeps</span><b>{m['sweeps_a']}&ndash;{m['sweeps_b']}
          </b></div>
        <div><span>avg winning bid</span><b>{m['avg_bid_A']} /
          {m['avg_bid_B']}</b></div>
        <div><span>set rate</span><b>{m['set_A']}% / {m['set_B']}%</b>
          </div>
      </div>
    </div>
    <div class="mright">
      <div class="clabel">FINAL SCORES <span class="sub">share of games
        per bucket</span></div>
      {score_chart(m, fmt)}
      <div class="clabel">WINNING BIDS &times; MAKE-VS-SET
        <span class="sub">bar height = share of that side's contracts;
        red top = the set share, %-label = set rate at that bid</span>
      </div>
      {bid_chart(m)}
    </div>
  </div>
</div>"""


def ladder_svg():
    pts = []
    for i, (slug, name, _sub) in enumerate(OPPONENTS):
        s = pool(KEYS[(slug, "s")])
        mm = pool(KEYS[(slug, "m")])
        x = 90 + i * 88
        ys = 250 - (s["win"] - 20) * 3.2
        ym = 250 - (mm["win"] - 20) * 3.2
        pts.append(
            f'<line x1="{x}" y1="{ys:.0f}" x2="{x}" y2="{ym:.0f}" '
            f'stroke="var(--rule)"/>'
            f'<circle cx="{x}" cy="{ys:.0f}" r="6" fill="var(--gold)"/>'
            f'<circle cx="{x}" cy="{ym:.0f}" r="6" fill="var(--green)"/>'
            f'<text x="{x}" y="272" text-anchor="middle" class="tkb">'
            f'{name.split(" ")[0]}</text>'
            f'<text x="{x}" y="{min(ys, ym) - 12:.0f}" text-anchor="middle"'
            f' class="tk">{max(s["win"], mm["win"]):.0f}</text>')
    grid = "".join(
        f'<line x1="60" y1="{250 - (v - 20) * 3.2:.0f}" x2="880" '
        f'y2="{250 - (v - 20) * 3.2:.0f}" stroke="var(--grid)" '
        f'stroke-dasharray="3 3"/><text x="52" '
        f'y="{254 - (v - 20) * 3.2:.0f}" text-anchor="end" class="tk">'
        f'{v}%</text>' for v in (30, 50, 70))
    return (f'<svg viewBox="0 0 900 285" class="chart">{grid}'
            f'{"".join(pts)}</svg>')


cards_s = "".join(card(s, n, d, "s") for s, n, d in OPPONENTS)
cards_m = "".join(card(s, n, d, "m") for s, n, d in OPPONENTS)

html = f"""<title>gen23 runs the gauntlet — 18 matchups</title>
<style>
:root {{ --paper:#f6f4ee; --ink:#1c2230; --muted:#5c6472; --rule:#d8d4c8;
  --card:#fffdf8; --rook:#2456a6; --red:#b3402e; --green:#2e7d4f;
  --gold:#c8961d; --slate:#7a8294; --grid:#e3e0d6;
  --shadow:0 1px 0 rgba(28,34,48,.05),0 10px 30px -22px rgba(28,34,48,.55);
  --display:"Avenir Next",Avenir,Futura,"Century Gothic","Segoe UI",
    sans-serif;
  --body:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",
    Arial,sans-serif;
  --data:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --paper:#11151f; --ink:#e4e6ec; --muted:#98a0b0; --rule:#2a3140;
    --card:#181d2a; --rook:#5b8bd9; --red:#d0604c; --green:#4aa375;
    --gold:#dbaa3d; --slate:#7d879c; --grid:#232a3a;
    --shadow:0 1px 0 rgba(0,0,0,.35),0 12px 32px -24px #000; }} }}
:root[data-theme="dark"] {{ --paper:#11151f; --ink:#e4e6ec;
  --muted:#98a0b0; --rule:#2a3140; --card:#181d2a; --rook:#5b8bd9;
  --red:#d0604c; --green:#4aa375; --gold:#dbaa3d; --slate:#7d879c;
  --grid:#232a3a;
  --shadow:0 1px 0 rgba(0,0,0,.35),0 12px 32px -24px #000; }}
:root[data-theme="light"] {{ --paper:#f6f4ee; --ink:#1c2230;
  --muted:#5c6472; --rule:#d8d4c8; --card:#fffdf8; --rook:#2456a6;
  --red:#b3402e; --green:#2e7d4f; --gold:#c8961d; --slate:#7a8294;
  --grid:#e3e0d6;
  --shadow:0 1px 0 rgba(28,34,48,.05),0 10px 30px -22px
    rgba(28,34,48,.55); }}
body {{ background:var(--paper); color:var(--ink);
  font-family:var(--body); font-size:16px; line-height:1.6; margin:0;
  padding:0 18px 90px; -webkit-font-smoothing:antialiased; }}
.wrap {{ max-width:880px; margin:0 auto; }}
h1,h2 {{ font-family:var(--display); font-weight:700;
  letter-spacing:-.01em; line-height:1.1; text-wrap:balance; }}
h1 {{ font-size:clamp(2rem,5vw,2.9rem); margin:0 0 .25em; }}
h2 {{ font-size:1.5rem; margin:44px 0 4px; }}
.eyebrow {{ font-family:var(--data); font-size:.68rem;
  letter-spacing:.18em; text-transform:uppercase; color:var(--muted);
  margin:0 0 1.1em; }}
header {{ padding:60px 0 10px; }}
.standfirst {{ font-size:1.15rem; color:var(--muted); line-height:1.5;
  max-width:38em; }}
.sub {{ color:var(--muted); font-size:.78rem; font-weight:400; }}
.chart {{ width:100%; height:auto; display:block; }}
.tk {{ font-family:var(--data); font-size:11px; fill:var(--muted); }}
.tkb {{ font-family:var(--data); font-size:12px; fill:var(--ink); }}
.dv {{ font-family:var(--display); font-weight:700; font-size:21px;
  fill:var(--ink); }}
.ds {{ font-family:var(--data); font-size:10px; fill:var(--muted); }}
.mcard {{ background:var(--card); border:1px solid var(--rule);
  box-shadow:var(--shadow); margin:20px 0; }}
.mhead {{ display:flex; justify-content:space-between; gap:10px;
  align-items:center; padding:12px 18px; border-bottom:1px solid
  var(--rule); flex-wrap:wrap; }}
.mname {{ font-family:var(--display); font-weight:700;
  font-size:1.15rem; }}
.msub {{ color:var(--muted); font-size:.8rem;
  font-family:var(--data); }}
.verdict {{ font-family:var(--display); font-weight:700;
  font-size:1.05rem; padding:2px 14px; border-radius:3px; }}
.vw {{ color:var(--green); border:2px solid var(--green); }}
.vl {{ color:var(--red); border:2px solid var(--red); }}
.ve {{ color:var(--gold); border:2px solid var(--gold); }}
.mbody {{ display:grid; grid-template-columns:150px 1fr; gap:18px;
  padding:16px 18px; }}
@media (max-width:640px) {{ .mbody {{ grid-template-columns:1fr; }} }}
.donut {{ width:120px; height:120px; }}
.mstats {{ font-size:.82rem; margin-top:10px; }}
.mstats div {{ display:flex; justify-content:space-between; gap:8px;
  border-bottom:1px solid var(--rule); padding:3px 0; }}
.mstats span {{ color:var(--muted); font-size:.7rem;
  font-family:var(--data); text-transform:uppercase;
  letter-spacing:.06em; }}
.mstats b {{ font-family:var(--data); }}
.clabel {{ font-family:var(--data); font-size:.68rem;
  letter-spacing:.12em; margin:12px 0 4px; color:var(--ink); }}
.key {{ display:flex; flex-wrap:wrap; gap:14px; font-size:.78rem;
  color:var(--muted); font-family:var(--data); margin:6px 0 20px; }}
.key i {{ display:inline-block; width:10px; height:10px;
  margin-right:5px; border-radius:2px; vertical-align:-1px; }}
.callout {{ background:var(--card); border:1px solid var(--rule);
  border-left:3px solid var(--gold); padding:16px 20px; margin:22px 0;
  box-shadow:var(--shadow); }}
</style>
<div class="wrap">
<header>
<p class="eyebrow">Rook13 &middot; AlphaRook &middot; gen23 examination</p>
<h1>gen23 runs the gauntlet</h1>
<p class="standfirst">Eighteen matchups: the new clone against every
generation that came before it — plus the teacher it learned from —
in both the sprint games humans play and the marathons that tell the
truth. Fresh decks, every deal played twice with seats swapped.</p>
</header>

<h2>The ladder at a glance</h2>
{ladder_svg()}
<div class="key"><span><i style="background:var(--gold)"></i>sprint
(to 500) win%</span><span><i style="background:var(--green)"></i>marathon
(to 2,000) win%</span></div>
<div class="callout"><b>How to read it:</b> a perfect staircase. gen23
beats everything it should beat, by more in marathons than sprints
(small edges compound), and loses only to its own teacher — the search
player it was distilled from, which still has the two-second pause
gen23 gave up. No upsets, no non-transitivity: a clean new top rung
among the reflexes.</div>

<h2>&#127939; Sprints — standard games to 500</h2>
<div class="key"><span><i style="background:var(--rook)"></i>gen23</span>
<span><i style="background:var(--slate)"></i>opponent</span>
<span><i style="background:var(--red)"></i>set portion of contracts
</span></div>
{cards_s}

<h2>&#127807; Marathons — games to 2,000</h2>
{cards_m}

<footer style="padding:40px 0 0;color:var(--muted);font-size:.84rem;
border-top:1px solid var(--rule)">
<p>18 matchups &middot; 13,700 games &middot; duplicate decks, seats
swapped, fresh seeds throughout. gen23 = pure reflex (zero search at
play time), trained by cloning 54M decisions of the gen21+t0 teacher.
The gen21 rows pool the independent replication batteries. Bids come
from near-identical brains in every matchup, so score and set-rate
differences are card play. Full methodology: the AlphaRook generation
ledger, gen23.</p></footer>
</div>"""

open(OUT, "w").write(html)
print("written", len(html))
