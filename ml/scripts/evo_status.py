#!/usr/bin/env python3
"""Fleet dashboard v4 — DARWIN GYM (gen22 era). Cron every 10 min on hil-1;
serves on :8080. Pulls each city's runs/<run>/status.json (written by
alpharook/evo.py every 25 rounds), plus the world-cup history on the hub,
and renders one page: are we closing on the goal — a fighter that beats
frozen gen21 60%+?"""
import json
import subprocess
import time
from pathlib import Path

CITIES = [
    ("provo", None, "evo-provo", "Riley mix 15/35/50"),
    ("orem", "5.78.130.139", "evo-orem", "hard-contest 2/18/80"),
    ("logan", "5.78.128.203", "evo-logan", "hot culture: lr 5e-5, eps .12"),
    ("moab", "5.78.135.83", "evo-moab", "CONTROL: random decks"),
]
CUP_HISTORY = "/root/rook13/ml/runs/worldcup/history.jsonl"
GOAL = 0.60


def fetch(ip, run):
    path = f"/root/rook13/ml/runs/{run}/status.json"
    try:
        if ip is None:
            return json.loads(Path(path).read_text())
        out = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
             f"root@{ip}", f"cat {path}"],
            capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout)
    except Exception:
        return None


def spark(curve, w=260, h=44):
    """Inline SVG sparkline of exam win rate vs gen21 (best solid, mean
    faint), with the 50% line and the 60% goal line."""
    if not curve:
        return "<span style='color:#666'>no exams yet</span>"
    pts = curve[-60:]
    n = max(2, len(pts))

    def poly(key, color, width):
        ys = [p[key] for p in pts]
        xy = " ".join(f"{i * (w - 4) / (n - 1) + 2:.0f},"
                      f"{h - 2 - min(1.0, max(0.0, y)) * (h - 4):.0f}"
                      for i, y in enumerate(ys))
        return (f"<polyline points='{xy}' fill='none' stroke='{color}' "
                f"stroke-width='{width}'/>")

    def hline(y, color, dash):
        yy = h - 2 - y * (h - 4)
        return (f"<line x1='2' y1='{yy:.0f}' x2='{w - 2}' y2='{yy:.0f}' "
                f"stroke='{color}' stroke-dasharray='{dash}'/>")

    return (f"<svg width={w} height={h} style='background:#181818;"
            f"border:1px solid #333'>{hline(0.5, '#555', '2,3')}"
            f"{hline(GOAL, '#c94', '4,3')}"
            f"{poly('mean', '#468', 1)}{poly('best', '#4c4', 2)}</svg>")


def city_block(name, culture, s):
    if s is None:
        return (f"<div class=city><h2>{name}</h2>"
                f"<p style='color:#f66;font-weight:bold'>NO DATA</p></div>")
    age_min = (time.time() - s["ts"]) / 60
    ok = age_min < 30
    verdict = "EVOLVING" if ok else "CHECK ME"
    color = "#4c4" if ok else "#f66"
    best = s.get("best") or {}
    best_txt = (f"{best['name']} @ <b>{best['wr']:.1%}</b> vs gen21"
                if best.get("wr") is not None else "no bank yet")
    tot = s["totals"]
    pr = s.get("pos_rate")
    farm_txt = (f"beats-champ hand rate {pr:.1%} (lifetime "
                f"+{tot.get('pos', 0):,}/-{tot.get('neg', 0):,})"
                if pr is not None else "farming…")
    rate = s.get("rate_games_day")
    exam_rows = ""
    if s.get("exams"):
        ex = s["exams"][-1]
        rows = []
        for nm, wr in sorted(ex["fitness"].items(), key=lambda kv: -kv[1]):
            t = ex["tiers"].get(nm, {}).get("contested", {})
            ss = t.get("skill_share")
            rows.append(f"<tr><td>{nm}</td><td>{wr:.0%}</td>"
                        f"<td>{'' if ss is None else f'{ss:.0%}'}</td></tr>")
        swaps = ", ".join(ex.get("swaps") or []) or "no swaps"
        exam_rows = (f"<table><tr><th>fighter (pedigree)</th>"
                     f"<th>exam vs gen21</th><th>skill-share*</th></tr>"
                     f"{''.join(rows)}</table>"
                     f"<p class=sub>selection {ex['sel']} @ round "
                     f"{ex['round']} ({ex['pairs']} marathon pairs, salted "
                     f"held-out contested decks) — {swaps}</p>")
    return f"""<div class=city>
<h2>{name} <span style='color:{color}'>{verdict}</span></h2>
<p class=sub>{culture} · rules {s['config']['lose']}..{s['config']['win']}
 · lr {s['config']['lr']:g} · eps {s['config']['eps']:g}</p>
<p>round {s['round']:,} · {tot['games']:,} games · {tot['hands']:,} hands ·
{tot['rows']:,} rows{f" · {rate / 1000:.0f}k games/day" if rate else ""}</p>
<p>best banked: {best_txt}</p>
{spark(s.get('curve', []))}
<p class=sub>{farm_txt}</p>
{exam_rows}</div>"""


def cup_block():
    try:
        lines = Path(CUP_HISTORY).read_text().strip().splitlines()
    except Exception:
        lines = []
    if not lines:
        return ("<p class=sub>no world cup yet — first cup fires daily at "
                "14:30 UTC (8:30am MT)</p>")
    cup = json.loads(lines[-1])
    stand = " &nbsp;→&nbsp; ".join(f"{n} {wr:.1%}" for n, wr in
                                   cup["standings"])
    vs = " · ".join(f"{n} <b>{w:.1%}</b>" for n, w in
                    sorted(cup["vs_gen21"].items(), key=lambda kv: -kv[1]))
    hist = [{"best": c.get("best", {}).get("wr_vs_gen21", 0) or 0,
             "mean": (sum(c["vs_gen21"].values()) / len(c["vs_gen21"]))
             if c.get("vs_gen21") else 0}
            for c in map(json.loads, lines)]
    bat = ""
    if cup.get("battery"):
        b = cup["battery"]
        bat = (f"<p><b>PROMOTION BATTERY</b> (random decks): sprint "
               f"{b['sprint_wr']:.1%} / {b['sprint_pairs']} pairs · marathon "
               f"{b['marathon_wr']:.1%} / {b['marathon_pairs']} pairs</p>")
    return (f"<p><b>cup {cup['stamp']}</b> ({cup['pairs']} pairs/pairing, "
            f"contested marathon): {stand}</p>"
            f"<p>city champions vs frozen gen21: {vs}</p>{bat}"
            f"{spark(hist, w=420, h=54)}")


def main():
    blocks, best_overall = [], 0.0
    tot_games = tot_hands = 0
    for name, ip, run, culture in CITIES:
        s = fetch(ip, run)
        blocks.append(city_block(name, culture, s))
        if s:
            tot_games += s["totals"]["games"]
            tot_hands += s["totals"]["hands"]
            b = (s.get("best") or {}).get("wr")
            if b:
                best_overall = max(best_overall, b)
    goal_pct = min(100, best_overall / GOAL * 100)
    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=300>
<title>DARWIN GYM — gen22</title>
<style>body{{background:#111;color:#ddd;font:14px/1.5 monospace;padding:24px;
max-width:1150px}}
table{{border-collapse:collapse;margin:8px 0}}
td,th{{border:1px solid #333;padding:3px 10px;text-align:left}}
h1{{font-size:19px}} h2{{font-size:15px}} .sub{{color:#888}}
.city{{border:1px solid #2a2a2a;padding:6px 16px;margin:10px 0;
background:#161616}}
.goal{{background:#1a1a10;border:1px solid #553;padding:8px 16px}}
.bar{{background:#222;height:10px;width:420px;display:inline-block}}
.fill{{background:#4c4;height:10px;display:block}}</style></head><body>
<h1>&#129516; DARWIN GYM — evolution on gen21, contested-deck curriculum</h1>
<div class=goal><b>THE GOAL: beat frozen gen21 at 60%+</b> (then the
random-deck battery, then production on rook13.com)<br>
best banked exam so far: <b>{best_overall:.1%}</b>
<span class=bar><span class=fill style='width:{goal_pct:.0f}%'></span></span>
{GOAL:.0%}<br><span class=sub>fleet lifetime this era: {tot_games:,} games ·
{tot_hands:,} hands · updated {time.strftime('%Y-%m-%d %H:%M UTC',
time.gmtime())}</span></div>
{''.join(blocks)}
<h2>&#127942; WORLD CUP</h2>
{cup_block()}
<p class=sub>* skill-share = of the exam hands that were skill-decided
(same side won them from both chairs — ~26% of random hands, more on
contested decks), the share the fighter took. gen21's own edge over Puma
was 53-54% skill-share; sustained 55%+ here is a real rung.<br>
cities: 6 learners sparring frozen gen21 on mirrored hand-pairs (CE
self-imitation: clone verified wins, champion pulls back losses) ·
selection every 2h:
clone top-2 banked, cull bottom-2 (pedigree = name.c&lt;round&gt;) ·
exams on held-out contested decks, salted per city+day (law 8) ·
moab trains on RANDOM decks as the control — if curation is the active
ingredient, it must fall behind. Riley's cadence: ~10am / ~10pm MT.
If CHECK ME: ping Claude.</p>
</body></html>"""
    Path("/root/status").mkdir(exist_ok=True)
    Path("/root/status/index.html").write_text(page)


if __name__ == "__main__":
    main()
