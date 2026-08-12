#!/usr/bin/env python3
"""Deep-dive rollup: merge grades + stats into report-ready JSON.

    ~/torch-env/bin/python scripts/prod_report.py
"""

import glob
import json
import statistics
import sys
import os
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from rook.cards import CARD_POINTS, SUIT_NAMES

TRIO = ("Nate Girsberger", "Tyler Girsberger", "Carson Gardner")


def num_of(c):
    return c % 10 + 5


def suit_of(c):
    return c // 10


def card_str(c):
    return f"{SUIT_NAMES[suit_of(c)]} {num_of(c)}"


def main():
    rows = [json.loads(l) for p in glob.glob(
        "runs/prodgames/grades.jsonl.w*") for l in open(p)]
    plays = [r for r in rows if r["type"] == "PLAY"]
    wids = [r for r in rows if r["type"] == "WIDOW"]

    out = dict(n_plays=len(plays), n_widows=len(wids), players={})
    for name in TRIO:
        pp = [r for r in plays if r["who"] == name]
        ww = [r for r in wids if r["who"] == name]
        if not pp:
            continue
        d = [r["delta"] for r in pp if r["delta"] is not None]
        agree = sum(1 for r in pp if r["chose"] == r["bot_pick"])

        # role/phase cuts
        cuts = {}
        for label, sel in [
            ("lead", lambda r: r["pos"] == 0),
            ("follow", lambda r: r["pos"] > 0),
            ("buyer_team", lambda r: r["my_team_buying"] == 1),
            ("defending", lambda r: r["my_team_buying"] == 0),
            ("early(t0-2)", lambda r: r["trick"] <= 2),
            ("late(t6+)", lambda r: r["trick"] >= 6),
        ]:
            v = [r["delta"] for r in pp
                 if sel(r) and r["delta"] is not None]
            a = [r for r in pp if sel(r)]
            cuts[label] = dict(
                n=len(a),
                agree=round(sum(1 for r in a
                                if r["chose"] == r["bot_pick"])
                            / max(1, len(a)), 3),
                mean_delta=round(statistics.mean(v), 2) if v else None)

        # biggest blunders (most negative) and beat-the-bot (most positive)
        graded = [r for r in pp if r["delta"] is not None]
        worst = sorted(graded, key=lambda r: r["delta"])[:8]
        best = sorted(graded, key=lambda r: -r["delta"])[:8]

        def brief(r):
            return dict(game=r["game"], hand=r["hand"], trick=r["trick"],
                        chose=card_str(r["chose"]),
                        rc1=card_str(r["bot_pick"]),
                        delta=round(r["delta"], 1),
                        role=("buyer-team" if r["my_team_buying"]
                              else "defending"),
                        lead=(r["pos"] == 0))

        wd = [r["delta"] for r in ww if "delta" in r]
        out["players"][name] = dict(
            n_graded=len(pp), agree_pct=round(agree / len(pp), 3),
            mean_delta=round(statistics.mean(d), 2),
            clean_pct=round(sum(1 for x in d if x >= -0.01) / len(d), 3),
            big_err_pct=round(sum(1 for x in d if x < -10) / len(d), 3),
            beat_bot_pct=round(sum(1 for x in d if x > 2) / len(d), 3),
            cuts=cuts,
            widows=dict(n=len(wd),
                        mean_delta=(round(statistics.mean(wd), 1)
                                    if wd else None),
                        exact=round(sum(1 for x in wd if x == 0)
                                    / max(1, len(wd)), 3)),
            worst=[brief(r) for r in worst],
            best=[brief(r) for r in best],
        )

    # convention cost: partner-seat trick-0 leads, human led boss14 or
    # returned trump — what did RC1 want, what did it cost?
    conv = defaultdict(list)
    for r in plays:
        if r["trick"] != 0 or r["pos"] != 0 or r["delta"] is None:
            continue
        if r["my_team_buying"] != 1 or r["buyer"] == r["seat"]:
            continue
        c = r["chose"]
        cat = ("trump-return" if suit_of(c) == r["trump"] else
               "boss14" if num_of(c) == 14 else "other")
        conv[cat].append(r["delta"])
    out["partner_lead_convention"] = {
        k: dict(n=len(v), mean_delta=round(statistics.mean(v), 2),
                clean=round(sum(1 for x in v if x >= -0.01) / len(v), 3))
        for k, v in conv.items() if v}

    # per-hand summed regret (law-13 caveat: per-decision sums overstate
    # sequential per-hand effect 3-5x; comparative use only)
    byhand = defaultdict(float)
    for r in plays:
        if r["delta"] is not None:
            byhand[(r["who"], r["game"], r["hand"])] += r["delta"]
    for name in TRIO:
        v = [d for (w, _, _), d in byhand.items() if w == name]
        if v and name in out["players"]:
            out["players"][name]["hand_regret_sum"] = dict(
                n_hands=len(v), mean=round(statistics.mean(v), 1))

    # Cosmo (teacher) baseline on the same grader
    crows = [json.loads(l) for p in glob.glob(
        "runs/prodgames/cosmo_grades.jsonl.w*") for l in open(p)]
    cp = [r for r in crows if r["type"] == "PLAY"
          and r["delta"] is not None]
    cw = [r for r in crows if r["type"] == "WIDOW" and "delta" in r]
    if cp:
        out["cosmo_baseline"] = dict(
            n=len(cp),
            agree=round(sum(1 for r in cp
                            if r["chose"] == r["bot_pick"]) / len(cp), 3),
            mean_delta=round(statistics.mean(r["delta"] for r in cp), 2),
            clean_pct=round(sum(1 for r in cp if r["delta"] >= -0.01)
                            / len(cp), 3),
            widow_mean=(round(statistics.mean(r["delta"] for r in cw), 1)
                        if cw else None), widow_n=len(cw))

    # confirmed beats (K96 winner's-curse guard)
    conf = []
    for p in glob.glob("runs/prodgames/confirms.jsonl"):
        for line in open(p):
            conf.append(json.loads(line))
    if conf:
        surv = [c for c in conf if (c.get("delta96") or 0) > 2]
        out["beats_confirm"] = dict(
            candidates=len(conf), survived=len(surv),
            by_player=dict(Counter(c["who"] for c in surv)),
            rows=[dict(who=c["who"], game=c["game"], hand=c["hand"],
                       trick=c["trick"], chose=card_str(c["chose"]),
                       rc1=card_str(c["bot_pick"]),
                       d12=round(c["delta12"], 1),
                       d96=round(c["delta96"], 1))
                  for c in sorted(surv, key=lambda x: -x["delta96"])[:12]])

    # blunder verdicts
    verd = [json.loads(l) for p in glob.glob(
        "runs/prodgames/blunder_verdicts.jsonl.w*") for l in open(p)]
    vp = [r for r in verd if r.get("kind") == "play"
          and r.get("delta") is not None]
    vg = [r for r in verd if r.get("kind") == "godown"
          and r.get("delta") is not None]
    out["blunder_verdicts"] = dict(
        n_play=len(vp),
        family_right=sum(1 for r in vp if r["delta"] < -2),
        bot_right=sum(1 for r in vp if r["delta"] >= -2),
        mean_delta=(round(statistics.mean(r["delta"] for r in vp), 1)
                    if vp else None),
        n_godown=len(vg),
        godown_family_right=sum(1 for r in vg if r["delta"] < -2),
        examples=[dict(reporter=r["reporter"], actor=r.get("actor"),
                       reason=r["reason"][:120],
                       flagged=card_str(r["flagged_card"]),
                       rc1=card_str(r["rc1_pick"]),
                       delta=round(r["delta"], 1))
                  for r in sorted(vp, key=lambda x: x["delta"])[:10]])

    json.dump(out, open("runs/prodgames/report_data.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in out.items()
                      if k != "players"}, indent=1)[:1500])
    for n, p in out["players"].items():
        print(n, json.dumps({k: p[k] for k in
                             ("n_graded", "agree_pct", "mean_delta",
                              "clean_pct", "beat_bot_pct")}))


if __name__ == "__main__":
    main()
