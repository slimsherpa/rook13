#!/usr/bin/env python3
"""Render the AlphaGodRook gauntlet artifact — same card language as
'gen23 runs the gauntlet', with god gold and gen23's results as ghost
reference dots on the ladder."""
import json
import math

BASE = "/private/tmp/claude-501/-Users-rileyadamson-Documents-GitHub-rook13/1516f93a-98f5-40df-88de-20c61166b2cd/scratchpad"
R = json.load(open(f"{BASE}/god_report.json"))
G23 = json.load(open(f"{BASE}/gauntlet_report.json"))
OUT = f"{BASE}/godrook-gauntlet.html"

OPP = [
    ("teacher", "gen21+t0 · The Teacher", "the strongest mortal — K24 search from the opening lead", "gauntlet_teacher_sprint"),
    ("gen23", "gen23 — the new champion", "minted yesterday; the clone of the teacher", None),
    ("gen21", "gen21", "the reflex the teacher and god both bid with", "gauntlet_gen21_sprint2"),
    ("cosmo", "gen19 · Cosmo", "production top pick", "gauntlet_cosmo_sprint"),
    ("cougar", "gen16 · Cougar", "production search stack", "gauntlet_cougar_sprint"),
    ("gen13", "gen13 · Puma", "production reflex", "gauntlet_gen13_sprint"),
    ("gen11", "gen11 · Cub", "production search", "gauntlet_gen11_sprint"),
    ("gen10", "gen10 · Bobcat", "production reflex", "gauntlet_gen10_sprint"),
    ("gen9", "gen9 · Kitten", "first fully-neural champion", "gauntlet_gen9_sprint"),
    ("gen8", "gen8 · Stomper", "Riley's 99% benchmark", "gauntlet_gen8_sprint"),
]


def donut(win):
    rr = 44
    c = 2 * math.pi * rr
    a = c * win / 100
    return (f'<svg viewBox="0 0 120 120" class="donut">'
            f'<circle cx="60" cy="60" r="{rr}" fill="none" '
            f'stroke="var(--slate)" stroke-width="18"/>'
            f'<circle cx="60" cy="60" r="{rr}" fill="none" '
            f'stroke="var(--gold)" stroke-width="18" '
            f'stroke-dasharray="{a:.1f} {c - a:.1f}" '
            f'stroke-dashoffset="{c / 4:.1f}"/>'
            f'<text x="60" y="57" text-anchor="middle" class="dv">'
            f'{win:.1f}%</text>'
            f'<text x="60" y="74" text-anchor="middle" class="ds">GOD'
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
    bw = max(10, min(30, 580 // max(1, len(buckets)) // 2 - 2))
    peak = max(max(ha.values(), default=1), max(hb.values(), default=1)) / n
    parts = []
    x = 40
    for b in buckets:
        va = ha.get(b, 0) / n / peak * 100
        vb = hb.get(b, 0) / n / peak * 100
        parts.append(
            f'<g transform="translate({x},0)">'
            f'<rect x="0" y="{110 - va:.0f}" width="{bw}" height="{va:.0f}"'
            f' fill="var(--gold)"/>'
            f'<rect x="{bw + 2}" y="{110 - vb:.0f}" width="{bw}" '
            f'height="{vb:.0f}" fill="var(--slate)"/>'
            f'<text x="{bw}" y="124" text-anchor="middle" class="tk">'
            f'{b}</text></g>')
        x += bw * 2 + 12
    return (f'<svg viewBox="0 0 {max(640, x + 20)} 130" class="chart">'
            f'<line x1="30" y1="110" x2="{x}" y2="110" '
            f'stroke="var(--rule)"/>{"".join(parts)}</svg>')


def bid_chart(m):
    bids = [b for b in sorted(set(m["bids_A"]) | set(m["bids_B"]),
                              key=int)
            if (m["bids_A"].get(str(b), m["bids_A"].get(b, {"c": 0}))["c"]
                + m["bids_B"].get(str(b), m["bids_B"].get(b, {"c": 0}))
                ["c"]) > m["n"] * 0.02]
    tot = {s: max(1, m[f"contracts_{s}"]) for s in "AB"}
    parts = []
    x = 46
    for b in bids:
        da = m["bids_A"].get(str(b)) or m["bids_A"].get(b) or \
            {"c": 0, "set": 0}
        db = m["bids_B"].get(str(b)) or m["bids_B"].get(b) or \
            {"c": 0, "set": 0}
        for i, (d, t, cm) in enumerate(((da, tot["A"], "var(--gold)"),
                                        (db, tot["B"], "var(--slate)"))):
            share = d["c"] / t
            h = share * 150
            sh = h * (d["set"] / d["c"]) if d["c"] else 0
            xo = x + i * 26
            parts.append(
                f'<rect x="{xo}" y="{120 - h:.0f}" width="22" '
                f'height="{max(0, h - sh):.0f}" fill="{cm}"/>'
                f'<rect x="{xo}" y="{120 - sh:.0f}" width="22" '
                f'height="{sh:.0f}" fill="var(--red)" '
                f'opacity="{0.95 - i * 0.25}"/>')
            if d["c"] > 15:
                parts.append(f'<text x="{xo + 11}" y="{116 - h:.0f}" '
                             f'text-anchor="middle" class="tk">'
                             f'{d["set"] / d["c"] * 100:.0f}%</text>')
        parts.append(f'<text x="{x + 26}" y="134" text-anchor="middle" '
                     f'class="tkb">{b}</text>')
        x += 76
    return (f'<svg viewBox="0 0 {max(560, x)} 140" class="chart">'
            f'<line x1="30" y1="120" x2="{x - 10}" y2="120" '
            f'stroke="var(--rule)"/>{"".join(parts)}</svg>')


def pph(m):
    """points/hand from avg finals and hands (diff-sum equivalent)."""
    return (m["avg"]["A"] - m["avg"]["B"]) * m["n"] / max(1, m["hands"])


def card(slug, name, sub, fmt):
    key = f"god_{slug}_{'sprint' if fmt == 's' else 'marathon'}"
    if key not in R:
        return ""
    m = R[key]
    prec = 1.96 * math.sqrt(0.25 / m["n"]) * 100
    partial = "" if m["n"] >= (100 if fmt == "s" else 24) * 0.99 else \
        " &middot; still running"
    return f"""
<div class="mcard">
  <div class="mhead">
    <div><div class="mname">GOD vs {name}</div>
    <div class="msub">{sub} &middot; {m['n']:,} games &middot;
    {m['hands']:,} hands{partial}</div></div>
    <div class="verdict vw">WINS</div>
  </div>
  <div class="mbody">
    <div class="mleft">{donut(m['win'])}
      <div class="mstats">
        <div><span>pts / hand</span><b>{pph(m):+.1f}</b></div>
        <div><span>avg final</span><b>{m['avg']['A']:,} :
          {m['avg']['B']:,}</b></div>
        <div><span>sweeps</span><b>{m['sweeps_a']}&ndash;{m['sweeps_b']}
          </b></div>
        <div><span>make rate</span><b>{100 - m['set_A']:.0f}% /
          {100 - m['set_B']:.0f}%</b></div>
        <div><span>95% band</span><b>&plusmn;{prec:.0f}pp</b></div>
      </div>
    </div>
    <div class="mright">
      <div class="clabel">FINAL SCORES <span class="sub">gold = god
        &middot; share of games per bucket</span></div>
      {score_chart(m, fmt)}
      <div class="clabel">WINNING BIDS &times; MAKE-VS-SET
        <span class="sub">red top = set share at that bid</span></div>
      {bid_chart(m)}
    </div>
  </div>
</div>"""


def ladder():
    parts = []
    for i, (slug, name, _s, g23key) in enumerate(OPP):
        key = f"god_{slug}_sprint"
        if key not in R:
            continue
        x = 90 + i * 88
        yg = 250 - (R[key]["win"] - 20) * 2.6
        parts.append(
            f'<circle cx="{x}" cy="{yg:.0f}" r="7" fill="var(--gold)"/>'
            f'<text x="{x}" y="{yg - 12:.0f}" text-anchor="middle" '
            f'class="tkb">{R[key]["win"]:.0f}</text>'
            f'<text x="{x}" y="272" text-anchor="middle" class="tkb">'
            f'{name.split(" ")[0]}</text>')
        if g23key and g23key in G23:
            y2 = 250 - (G23[g23key]["win"] - 20) * 2.6
            parts.append(
                f'<circle cx="{x}" cy="{y2:.0f}" r="5" fill="none" '
                f'stroke="var(--rook)" stroke-width="2"/>')
        elif slug == "gen23":
            y2 = 250 - (50 - 20) * 2.6
            parts.append(
                f'<circle cx="{x}" cy="{y2:.0f}" r="5" fill="none" '
                f'stroke="var(--rook)" stroke-width="2"/>')
    grid = "".join(
        f'<line x1="60" y1="{250 - (v - 20) * 2.6:.0f}" x2="880" '
        f'y2="{250 - (v - 20) * 2.6:.0f}" stroke="var(--grid)" '
        f'stroke-dasharray="3 3"/><text x="52" '
        f'y="{254 - (v - 20) * 2.6:.0f}" text-anchor="end" class="tk">'
        f'{v}%</text>' for v in (40, 60, 80, 100))
    return (f'<svg viewBox="0 0 900 285" class="chart">{grid}'
            f'{"".join(parts)}</svg>')


cards_s = "".join(card(s, n, d, "s") for s, n, d, _ in OPP)
cards_m = "".join(card(s, n, d, "m") for s, n, d, _ in OPP)
tot_pairs = sum(m["pairs"] for m in R.values())
tot_osweeps = sum(m["sweeps_b"] for m in R.values())

html = f"""<title>AlphaGodRook runs the gauntlet — the ceiling, measured</title>
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
.vw {{ color:var(--gold); border:2px solid var(--gold); }}
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
.key o {{ display:inline-block; width:10px; height:10px;
  margin-right:5px; border-radius:50%; border:2px solid var(--rook);
  vertical-align:-1px; }}
.callout {{ background:var(--card); border:1px solid var(--rule);
  border-left:3px solid var(--gold); padding:16px 20px; margin:22px 0;
  box-shadow:var(--shadow); }}
.lede {{ font-family:var(--display); font-weight:600; font-size:1.2rem;
  line-height:1.35; }}
</style>
<div class="wrap">
<header>
<p class="eyebrow">Rook13 &middot; AlphaRook &middot; the ceiling
measurement</p>
<h1>AlphaGodRook runs the gauntlet</h1>
<p class="standfirst">The omniscient cheater — exact-solver card play
that sees all four hands, bidding with an ordinary brain — against every
player this project has ever built, including the teacher. This is not a
contest. It is a measurement of how high the ceiling really is.</p>
</header>

<h2>The ladder, annihilated</h2>
{ladder()}
<div class="key"><span><i style="background:var(--gold)"></i>GOD sprint
win%</span><span><o></o>gen23's result vs the same opponent, for scale
</span></div>

<div class="callout">
<p class="lede">In {tot_pairs:,} duplicate-deck pairs across ten
opponents, the number of pairs any mortal swept against god is
{tot_osweeps}.</p>
<p>Every deal played twice, seats swapped. To sweep a pair you must win
holding the good cards <em>and</em> the bad ones. God has done it
hundreds of times tonight. Against god, nobody has done it once —
not even the teacher. And Riley's 99% intuition was right where he
aimed it: god vs gen8 is running at ~98%. The revision this forces:
<b>hidden information, not deal luck, is the real wall in Rook.</b>
An omniscient player's +40-points-per-hand edge steamrolls the deal
even in short games. Mortal players cluster far below the ceiling —
which means the space between the teacher and perfection is still
enormous.</p></div>

<h2>&#127939; Sprints — standard games to 500</h2>
<div class="key"><span><i style="background:var(--gold)"></i>god</span>
<span><i style="background:var(--slate)"></i>opponent</span>
<span><i style="background:var(--red)"></i>set portion</span></div>
{cards_s}

<h2>&#127807; Marathon anchors — games to 2,000</h2>
{cards_m}

<footer style="padding:40px 0 0;color:var(--muted);font-size:.84rem;
border-top:1px solid var(--rule)">
<p>Overnight run, six machines, ~2 minutes of exact search per hand.
God plays cards conditioned on the true deal (the one legitimate use of
peeking: a referee with a chair, never a teacher — its games are poison
for training and will never enter a corpus). Bids come from gen21's
brain in every arm, so auction behavior matches the mortal ladder.
Arms marked "still running" gain games by the hour; error bands shown
per card. Companion reports: "The 48-Hour Match" and "gen23 runs the
gauntlet."</p></footer>
</div>"""

open(OUT, "w").write(html)
print("written", len(html))
