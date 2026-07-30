#!/usr/bin/env python3
"""ALPHAGODROOK board — http://5.78.115.122:8080/god.html

Cron on the hub every 2 min. The overnight god gauntlet, live: progress
per arm, and the stats that already mean something at small n — points
per hand and make rates are per-HAND measures (~1,300 god hands per
finished arm), so they sharpen long before game win% does.

MBP arms (gen9, gen8) arrive via pushed dump copies in runs/mbpgod/.
"""
import json
import math
import subprocess
import time
from pathlib import Path

OUT = Path("/root/status/god.html")
B2, B3, B4, B5 = ("5.78.130.139", "5.78.128.203",
                  "5.78.135.83", "5.78.145.180")
RUNS = "/root/rook13/ml/runs"

# (label, box ip or None=hub, dump path, target games, format)
ARMS = [
    ("vs gen21+t0 — THE TEACHER", B3, f"{RUNS}/god_teacher_sprint.jsonl",
     100, "sprint"),
    ("vs gen23 — the new champion", None, f"{RUNS}/god_gen23_sprint.jsonl",
     100, "sprint"),
    ("vs gen21", B2, f"{RUNS}/god_gen21_sprint.jsonl", 100, "sprint"),
    ("vs gen19 · Cosmo", B4, f"{RUNS}/god_cosmo_sprint.jsonl", 100,
     "sprint"),
    ("vs gen16 · Cougar", B4, f"{RUNS}/god_cougar_sprint.jsonl", 100,
     "sprint"),
    ("vs gen13 · Puma", B3, f"{RUNS}/god_gen13_sprint.jsonl", 100,
     "sprint"),
    ("vs gen11 · Cub", B5, f"{RUNS}/god_gen11_sprint.jsonl", 100,
     "sprint"),
    ("vs gen10 · Bobcat", B5, f"{RUNS}/god_gen10_sprint.jsonl", 100,
     "sprint"),
    ("vs gen9 · Kitten (MBP)", None, f"{RUNS}/mbpgod/god_gen9_sprint.jsonl",
     100, "sprint"),
    ("vs gen8 · Stomper (MBP)", None, f"{RUNS}/mbpgod/god_gen8_sprint.jsonl",
     100, "sprint"),
    ("vs gen23 — marathon anchor", None,
     f"{RUNS}/god_gen23_marathon.jsonl", 24, "marathon"),
    ("vs gen21 — marathon anchor", B2,
     f"{RUNS}/god_gen21_marathon.jsonl", 24, "marathon"),
]


def shell(ip, cmd):
    try:
        if ip is None:
            return subprocess.run(["bash", "-c", cmd], capture_output=True,
                                  text=True, timeout=45).stdout
        return subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
             f"root@{ip}", cmd], capture_output=True, text=True,
            timeout=45).stdout
    except Exception:
        return ""


def stats(raw):
    n = wins = hands = 0
    sa = sb = diff_sum = 0
    con = {0: [0, 0], 1: [0, 0]}     # contracts, sets
    ws = []
    for line in raw.splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        n += 1
        ws.append(r["w"])
        wins += 1 if r["w"] == 0 else 0
        hands += r["hands"]
        sa += r["a"]
        sb += r["b"]
        for bidder, bid, made, diff in r["hh"]:
            diff_sum += diff
            con[bidder][0] += 1
            con[bidder][1] += 0 if made else 1
    if not n:
        return None
    pw = list(zip(ws[0::2], ws[1::2]))
    mk = lambda c: round((1 - c[1] / c[0]) * 100) if c[0] else 0
    return dict(n=n, hands=hands, win=round(wins / n * 100, 1),
                avg_a=round(sa / n), avg_b=round(sb / n),
                pph=round(diff_sum / hands, 1) if hands else 0,
                make_a=mk(con[0]), make_b=mk(con[1]),
                sweeps=f"{sum(1 for p in pw if p == (0, 0))}"
                       f"&ndash;{sum(1 for p in pw if p == (1, 1))}")


def main():
    now = time.time()
    rows = []
    tot_hands = 0
    for label, ip, path, target, fmt in ARMS:
        raw = shell(ip, f"cat {path} 2>/dev/null")
        st = stats(raw)
        if not st:
            rows.append(f"<tr><td><b>{label}</b> <span class=sub>{fmt}"
                        f"</span></td><td colspan=7 class=sub>queued / "
                        f"first pair still in the oven&hellip;</td></tr>")
            continue
        tot_hands += st["hands"]
        pct = min(100, st["n"] / target * 100)
        done = st["n"] >= target * 0.99
        prec = 1.96 * math.sqrt(0.25 / st["n"]) * 100
        rows.append(
            f"<tr class='{'done' if done else ''}'>"
            f"<td><b>{label}</b> <span class=sub>{fmt}</span></td>"
            f"<td class=num>{'&#10003;' if done else ''} "
            f"<span class=bar><span class=fill style='width:{pct:.0f}%'>"
            f"</span></span> {st['n']}/{target}</td>"
            f"<td class=num><b>{st['win']}%</b><br><span class=sub>"
            f"&plusmn;{prec:.0f}</span></td>"
            f"<td class=num>{st['pph']:+.1f}</td>"
            f"<td class=num>{st['avg_a']:,} : {st['avg_b']:,}</td>"
            f"<td class=num>{st['make_a']}% / {st['make_b']}%</td>"
            f"<td class=num>{st['sweeps']}</td>"
            f"<td class=num>{st['hands']:,}</td></tr>")

    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=120>
<title>AlphaGodRook — live</title>
<style>body{{background:#11151f;color:#e4e6ec;font:14px/1.6 monospace;
padding:24px;max-width:1080px;margin:0 auto}}
h1{{font-size:19px;margin-bottom:2px}}
.sub{{color:#98a0b0;font-size:11px}}
table{{border-collapse:collapse;width:100%;margin:14px 0}}
td,th{{border:1px solid #2a3140;padding:7px 10px;text-align:left;
vertical-align:top}}
th{{background:#181d2a;color:#9c9;font-size:11px}}
.num{{text-align:right;white-space:nowrap}}
.bar{{background:#232a3a;height:9px;width:70px;display:inline-block;
vertical-align:middle}}
.fill{{background:#dbaa3d;height:9px;display:block}}
tr.done td{{background:#141a12}}
a{{color:#5b8bd9}}
.note{{background:#161616;border:1px solid #2a2a2a;padding:10px 16px;
margin-top:14px;color:#98a0b0;font-size:12px;line-height:1.7}}</style>
</head><body>
<h1>&#128329; ALPHAGODROOK — the omniscient cheater, live</h1>
<div class=sub>exact-solver card play (sees all four hands), gen21's
bidding &middot; ~2 min of thought per hand &middot;
{tot_hands:,} god-played hands so far &middot; refreshed
{time.strftime('%H:%M UTC', time.gmtime(now))} &middot;
<a href="/gauntlet.html">gen23 gauntlet</a> &middot;
<a href="/">corpus board</a></div>

<table>
<tr><th>matchup</th><th class=num>progress</th>
<th class=num>god win%</th><th class=num>pts/hand</th>
<th class=num>avg final (god : opp)</th>
<th class=num>make rate (god / opp)</th><th class=num>sweeps</th>
<th class=num>hands</th></tr>
{''.join(rows)}
</table>

<div class=note><b>Reading small samples honestly:</b> game win%% needs
hundreds of games; <b>pts/hand</b> and <b>make rate</b> are per-hand
measures and sharpen ~10x faster — trust them first. For scale: the
teacher's edge over gen21 was <b>+11 pts/hand</b> and it made 63%% of
its contracts. Wherever god lands on those two numbers is the honest
ceiling of Rook card play — the thing no player, silicon or human, can
exceed. First smoke read (6 games vs gen8): 100%% wins, +58 pts/hand,
93%% contracts made.</div>
</body></html>"""
    OUT.write_text(page)


if __name__ == "__main__":
    main()
