#!/usr/bin/env python3
"""Gauntlet board — http://5.78.115.122:8080/gauntlet.html

Cron on the hub every 2 min. gen23-cand1 vs every generation, sprints
first (Riley: "sprints are what humans play"), marathons as their own
category. Each row fills in live: progress bar while running, then the
summary stats (win%, avg finals, avg winning bid, set rate) once done.

Remote dumps are re-read only when their size changes (cache keyed on
file size), so the board stays cheap after arms finish.
"""
import json
import math
import subprocess
import time
from pathlib import Path

CACHE = Path("/root/status/gauntlet_cache.json")
OUT = Path("/root/status/gauntlet.html")
B2, B3, B4, B5 = ("5.78.130.139", "5.78.128.203",
                  "5.78.135.83", "5.78.145.180")

# (opponent label, sub, box ip or None=hub, dump file, target games)
SPRINTS = [
    ("gen21+t0 — THE TEACHER", "K24 search from the opening lead (slow, thinks)",
     B4, "gauntlet_teacher_sprint.jsonl", 700),
    ("gen21", "the donor — gen23 was warm-started from it",
     None, "gauntlet_gen21_sprint2.jsonl", 1500),
    ("gen19 · Cosmo", "PRODUCTION top pick — gen13 + belief + K8 search t3",
     B5, "gauntlet_cosmo_sprint.jsonl", 500),
    ("gen16 · Cougar", "production — gen13 + belief + K8 search t5",
     B4, "gauntlet_cougar_sprint.jsonl", 500),
    ("gen13 · Puma", "production reflex — the belief net",
     B2, "gauntlet_gen13_sprint.jsonl", 1000),
    ("gen11 · Cub", "production — gen10 + K8 search t4",
     B3, "gauntlet_gen11_sprint.jsonl", 500),
    ("gen10 · Bobcat", "production reflex",
     B3, "gauntlet_gen10_sprint.jsonl", 1000),
    ("gen9 · Kitten", "production reflex — first fully neural",
     B2, "gauntlet_gen9_sprint.jsonl", 1000),
    ("gen8 · Stomper", "production reflex",
     B2, "gauntlet_gen8_sprint.jsonl", 1000),
]
MARATHONS = [
    ("gen21+t0 — THE TEACHER", "", None, "gauntlet_teacher_marathon.jsonl", 200),
    ("gen21", "replication battery for the 58.1% screen",
     B3, "gauntlet_gen21_marathon2.jsonl", 1000),
    ("gen19 · Cosmo", "", B5, "gauntlet_cosmo_marathon.jsonl", 200),
    ("gen16 · Cougar", "", B4, "gauntlet_cougar_marathon.jsonl", 200),
    ("gen13 · Puma", "", B2, "gauntlet_gen13_marathon.jsonl", 600),
    ("gen11 · Cub", "", B3, "gauntlet_gen11_marathon.jsonl", 200),
    ("gen10 · Bobcat", "", B4, "gauntlet_gen10_marathon.jsonl", 400),
    ("gen9 · Kitten", "", B2, "gauntlet_gen9_marathon.jsonl", 400),
    ("gen8 · Stomper", "", B2, "gauntlet_gen8_marathon.jsonl", 400),
]


def shell(ip, cmd):
    try:
        if ip is None:
            return subprocess.run(["bash", "-c", cmd], capture_output=True,
                                  text=True, timeout=60).stdout
        return subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
             f"root@{ip}", cmd], capture_output=True, text=True,
            timeout=60).stdout
    except Exception:
        return ""


def stats_from(raw):
    n = wins = 0
    sa = sb = 0
    bids = {0: [0, 0, 0], 1: [0, 0, 0]}   # contracts, sets, bid_sum
    for line in raw.splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        n += 1
        wins += 1 if r["w"] == 0 else 0
        sa += r["a"]
        sb += r["b"]
        for bidder, bid, made, _ in r["hh"]:
            bids[bidder][0] += 1
            bids[bidder][1] += 0 if made else 1
            bids[bidder][2] += bid
    if not n:
        return None
    f = lambda s: (round(s[2] / s[0], 1), round(s[1] / s[0] * 100, 1)) \
        if s[0] else (0, 0)
    ab, aset = f(bids[0])
    bb, bset = f(bids[1])
    return dict(n=n, win=round(wins / n * 100, 1),
                avg_a=round(sa / n), avg_b=round(sb / n),
                bid_a=ab, bid_b=bb, set_a=aset, set_b=bset)


def main():
    now = time.time()
    try:
        cache = json.loads(CACHE.read_text())
    except Exception:
        cache = {}

    def row(label, sub, ip, fname, target):
        path = f"/root/rook13/ml/runs/{fname}"
        size = shell(ip, f"stat -c %s {path} 2>/dev/null").strip()
        key = f"{ip}:{fname}"
        if not size:
            return (f"<tr><td><b>{label}</b><br><span class=sub>{sub}</span>"
                    f"</td><td colspan=6 class=sub>queued&hellip;</td></tr>")
        ent = cache.get(key)
        if not ent or ent.get("size") != size:
            st = stats_from(shell(ip, f"cat {path}"))
            ent = dict(size=size, ts=now, st=st)
            cache[key] = ent
        st = ent.get("st")
        if not st:
            return (f"<tr><td><b>{label}</b><br><span class=sub>{sub}</span>"
                    f"</td><td colspan=6 class=sub>starting&hellip;</td></tr>")
        pct = min(100, st["n"] / target * 100)
        done = st["n"] >= target * 0.99
        prec = 1.96 * math.sqrt(0.25 / st["n"]) * 100
        wcls = ("win" if st["win"] - prec > 50 else
                "lose" if st["win"] + prec < 50 else "tie") if done else "run"
        prog = ("&#10003; DONE" if done else
                f"<span class=bar><span class=fill style='width:{pct:.0f}%'>"
                f"</span></span> {pct:.0f}%")
        return (f"<tr class='{'done' if done else ''}'>"
                f"<td><b>{label}</b><br><span class=sub>{sub}</span></td>"
                f"<td class=num>{prog}</td>"
                f"<td class=num>{st['n']:,}/{target:,}</td>"
                f"<td class='num {wcls}'><b>{st['win']}%</b><br>"
                f"<span class=sub>&plusmn;{prec:.1f}</span></td>"
                f"<td class=num>{st['avg_a']:,} : {st['avg_b']:,}</td>"
                f"<td class=num>{st['bid_a']} / {st['bid_b']}</td>"
                f"<td class=num>{st['set_a']}% / {st['set_b']}%</td></tr>")

    hdr = ("<tr><th>opponent</th><th class=num>progress</th>"
           "<th class=num>games</th><th class=num>gen23 win%</th>"
           "<th class=num>avg final (23 : opp)</th>"
           "<th class=num>avg bid (23 / opp)</th>"
           "<th class=num>set rate (23 / opp)</th></tr>")
    s_rows = "".join(row(*m) for m in SPRINTS)
    m_rows = "".join(row(*m) for m in MARATHONS)
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache))

    page = f"""<!doctype html><html><head><meta charset=utf-8>
<meta http-equiv=refresh content=120>
<title>gen23 — the gauntlet</title>
<style>body{{background:#11151f;color:#e4e6ec;font:14px/1.6 monospace;
padding:24px;max-width:1080px;margin:0 auto}}
h1{{font-size:19px;margin-bottom:2px}} h2{{font-size:15px;margin:26px 0 6px}}
.sub{{color:#98a0b0;font-size:11px}}
table{{border-collapse:collapse;width:100%;margin:8px 0}}
td,th{{border:1px solid #2a3140;padding:7px 10px;text-align:left;
vertical-align:top}}
th{{background:#181d2a;color:#9c9;font-size:11px}}
.num{{text-align:right;white-space:nowrap}}
.bar{{background:#232a3a;height:9px;width:90px;display:inline-block;
vertical-align:middle}}
.fill{{background:#5b8bd9;height:9px;display:block}}
tr.done td{{background:#141a12}}
.win{{color:#4aa375}} .lose{{color:#d0604c}} .tie{{color:#dbaa3d}}
a{{color:#5b8bd9}}</style></head><body>
<h1>&#9876;&#65039; gen23-cand1 — the gauntlet</h1>
<div class=sub>fresh seeds, duplicate decks, seats swapped &middot; gen23
is a pure reflex (zero search at play time) &middot; refreshed
{time.strftime('%H:%M UTC', time.gmtime(now))} &middot;
<a href="/">corpus board</a> &middot; <a href="/train.html">training
curves</a></div>

<h2>&#127939; SPRINTS — standard games to 500 (what humans play)</h2>
<table>{hdr}{s_rows}</table>

<h2>&#127807; MARATHONS — games to 2,000 (luck compressed, the honest
long read)</h2>
<table>{hdr}{m_rows}</table>

<div class=sub style="margin-top:14px">Win%% green/red only when the 95%%
band clears 50%% at completion. Set rate = share of that side's contracts
that failed. The full per-matchup charts (Riley's sketch: win pie, score
distributions, bid distribution, make-vs-set) ship as an artifact when the
board is all &#10003;.</div>
</body></html>"""
    OUT.write_text(page)


if __name__ == "__main__":
    main()
