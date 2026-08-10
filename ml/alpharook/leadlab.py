"""LEADLAB — the opening-lead improvement program, no hard rules allowed.

Riley's law (2026-08-09): the final AlphaRook never plays by script — it
must SEE the vision. So the convention ("play the 14") is used here only
as a teacher and a referee, never a player. Per corpus lead position:

  recorded : the lead RC1 actually played (baseline)
  deep     : argmax over 3 x K averaged bel15 world-sittings — the
             no-rule "think harder + average the dice" candidate fix
             (attacks the measured suit-flip instability directly)
  conv     : highest off-trump boss 14 when held (teacher signal — its
             margin over `recorded` maps WHERE the vision is missing)
  reflex   : the bare habit net's pick (prices what search adds)

Each distinct candidate is played out to hand end with the frozen anytime
core on all seats, `--reps` different core seeds averaged. Every playout
is banked as (position, lead, outcome) — the outcome-labeled corpus a
future net fine-tune learns the vision from.

    ~/torch-env/bin/python -m alpharook.leadlab --hours 11 --workers 14 \
        --out runs/leadlab/leadlab.jsonl
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import time

import torch

from rook.cards import team_of
from .anytime import AnytimeRookAgent, observe
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .lab_score import lead_arms, convention_lead
from .model import load_qnet


def deep_choice(ag, env, seat, cands, k, sittings, base_seed):
    """Argmax over `sittings` independent world-batches of size k,
    averaged — no confirm gate, no rule; just more, steadier evidence."""
    g = env.g
    o = observe(g, seat)
    try:
        probs = ag.belief.posterior(env, seat, o, D_PLAY, cands)
    except Exception:
        probs = None
    totals = {c: 0.0 for c in cands}
    n = 0
    for s in range(sittings):
        rng = random.Random((base_seed + s * 7919) & 0x7FFFFFFF)
        got = 0
        for _ in range(k * 3):
            if got >= k:
                break
            wv = ag._world_values(o, g, list(cands), rng, probs,
                                  team_of(g.bid_winner), g.high_bid,
                                  team_of(seat))
            if wv is None:
                continue
            for c in cands:
                totals[c] += wv[c]
            got += 1
        n += got
    if n < k:
        return None
    return max(cands, key=lambda c: totals[c])


def positions(paths, rng):
    """Yield (rec, hand_no, seat, cards, trump, buyerRel, recorded_lead)."""
    for path in paths:
        lines = open(path).read().splitlines()
        rng.shuffle(lines)
        for line in lines:
            rec = json.loads(line)
            if rec.get("flip", 0) != 0:
                continue
            env = SelfPlayGame(seed=rec["seed"],
                              deck_fn=deck_stream(rec["seed"]),
                              dealer=rec["seed"] % 4,
                              win_score=rec.get("win", 500),
                              lose_score=rec.get("lose", -250))
            target = rng.randrange(0, 12)
            try:
                for (seat, dtype, action, *_r) in rec["d"]:
                    e_seat, e_dtype, cands = env.decision()
                    if e_seat != seat or e_dtype != dtype:
                        break
                    g = env.g
                    if (dtype == D_PLAY and g.hand_number >= target
                            and not g.completed_tricks and not g.trick_plays
                            and len(cands) > 1):
                        yield (rec, g.hand_number, seat,
                               sorted(g.hands[seat]), int(g.trump),
                               (g.bid_winner - seat) % 4, int(action))
                        break
                    env.apply(action)
            except Exception:
                continue


def _worker(t):
    (wid, nw, hours, k, sittings, reps, out_path) = t
    torch.set_num_threads(1)
    net = load_qnet("models/gen21-cand1.pt")
    net.eval()
    belief = BeliefOracle("models/gen15.pt", temp=0.5)
    ag = AnytimeRookAgent(net, belief)
    cores = [AnytimeRookAgent(net, belief, seed=1000 + r).choose
             for r in range(reps)]
    from .arena import model_choose
    rng = random.Random(0x1EAD ^ wid)
    paths = sorted(glob.glob("runs/belief/soak_box*_acts.jsonl"))
    f = open(out_path.replace(".jsonl", f"_w{wid}.jsonl"), "a")
    t_end = time.time() + hours * 3600
    n = 0
    for i, pos in enumerate(positions(paths, rng)):
        if i % nw != wid:
            continue
        if time.time() > t_end:
            break
        rec, hand_no, seat, cards, trump, buyer_rel, recorded = pos
        # rebuild env to the decision for choice computation
        env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                           dealer=rec["seed"] % 4,
                           win_score=rec.get("win", 500),
                           lose_score=rec.get("lose", -250))
        cands = None
        with torch.no_grad():
            for (s0, dt, action, *_r) in rec["d"]:
                e_seat, e_dtype, cs = env.decision()
                g = env.g
                if (dt == D_PLAY and g.hand_number == hand_no and s0 == seat
                        and not g.completed_tricks and not g.trick_plays):
                    cands = cs
                    break
                env.apply(action)
        if cands is None:
            continue
        with torch.no_grad():
            deep = deep_choice(ag, env, seat, cands, k, sittings,
                               rec["seed"] ^ 0xD33)
            reflex = model_choose(net, "cpu", env, seat, D_PLAY, cands)
        conv = convention_lead(cards, trump)
        arms = {"recorded": recorded}
        if deep is not None and deep != recorded:
            arms["deep"] = deep
        if conv is not None and conv not in arms.values():
            arms["conv"] = conv
        if reflex not in arms.values():
            arms["reflex"] = int(reflex)
        try:
            res = lead_arms(rec, hand_no, seat,
                            [(tag, c) for tag, c in arms.items()], cores)
        except Exception:
            res = None
        if res is None:
            continue
        row = dict(seed=rec["seed"], hand=hand_no, seat=seat,
                   buyerRel=buyer_rel, trump=trump, cards=cards,
                   leads={tag: int(arms[tag]) for tag in arms},
                   pts={tag: res[tag] for tag in res},
                   deep=int(deep) if deep is not None else None,
                   conv=int(conv) if conv is not None else None,
                   reflex=int(reflex))
        f.write(json.dumps(row) + "\n")
        f.flush()
        n += 1
        if wid == 0 and n % 5 == 0:
            print(f"  [w0] {n} positions "
                  f"({(t_end - time.time()) / 3600:.1f}h left)", flush=True)
    f.close()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=11)
    ap.add_argument("--k", type=int, default=96)
    ap.add_argument("--sittings", type=int, default=3)
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--out", default="runs/leadlab/leadlab.jsonl")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    import multiprocessing as mp
    jobs = [(w, args.workers, args.hours, args.k, args.sittings, args.reps,
             args.out) for w in range(args.workers)]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        counts = pool.map(_worker, jobs)
    print(f"leadlab: {sum(counts)} positions banked")


if __name__ == "__main__":
    main()
