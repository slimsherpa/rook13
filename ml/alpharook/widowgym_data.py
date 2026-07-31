"""The widow gym's data engine (gen24 Act VI — Riley's design, 2026-07-31).

Baseline: gen23 plays whole games; every contract's widow state is
snapshotted and its ACTUAL outcome recorded (that's the baseline
histogram for free). Then, per contract, a small menu of ALTERNATIVE
(go-down, trump) choices is rolled out in the SAME frozen world — same
deal, same auction, same card play policy — and each is labeled with
its hand score minus gen23's hand score. "Beat gen23's widow, get
rewarded." Deal luck cancels; even +5 is real.

Candidates are UNBIASED uniform samples of the raw (discard, trump)
space — no strategy templates, no category tags (v1 had them; Riley's
correction: categories smuggle the designer's theories into the data,
and widow wisdom is situational — "it depends" IS the skill). The study
derives whatever features it wants from the raw choices afterward, and
the learner is free to find logic no category anticipated.

    ~/torch-env/bin/python -m alpharook.widowgym_data --minutes 20 --workers 8

Shards: runs/gen24/widowgym/shards/wN_XXXX.jsonl — one line per contract,
raw state + tagged candidate outcomes; whole shards only (tmp-rename).
"""

from __future__ import annotations

import argparse
import glob
import itertools
import json
import os
import random
import time

import torch

from rook.cards import SUITS, card_points, suit_of, num_of, team_of
from rook.engine import WIDOW, HAND_DONE, GAME_OVER
from rook.bots import choose_go_down
from .arena import model_choose
from .duel import deck_stream
from .encoder import D_TRUMP
from .env import SelfPlayGame
from .model import load_qnet

OUT_DIR = "runs/gen24/widowgym/shards"
CONTRACTS_PER_SHARD = 400


N_CANDIDATES = 14


def candidate_menu(hand13, g23_disc, g23_trump):
    """N uniform samples of the raw (discard, trump) space, deduped
    against gen23's own choice and each other. No templates, no tags."""
    own = (tuple(sorted(g23_disc)), g23_trump)
    suits_present = [s for s in SUITS
                     if any(suit_of(c) == s for c in hand13)]
    rng = random.Random(hash(tuple(sorted(hand13))) & 0xFFFFFF)
    seen = {own}
    menu = []
    tries = 0
    while len(menu) < N_CANDIDATES and tries < 400:
        tries += 1
        key = (tuple(sorted(rng.sample(list(hand13), 4))),
               rng.choice(suits_present))
        if key in seen:
            continue
        seen.add(key)
        menu.append((list(key[0]), key[1]))
    return menu


def rollout(g0, declarer, disc, trump, net):
    g = g0.clone()
    g.select_go_down(declarer, list(disc))
    g.select_trump(declarer, trump)

    class _E:
        pass
    e = _E()
    e.g = g
    e.picks = []
    e.trump_intent = None
    while g.phase not in (HAND_DONE, GAME_OVER):
        s = g.turn
        g.play_card(s, model_choose(net, "cpu", e, s, 3, g.legal_cards(s)))
    h = g.hand_history[-1]
    team = team_of(declarer)
    made = not h[6]
    score = h[4] if team == 0 else h[5]   # made -> pts taken, set -> -bid
    return made, int(score)


@torch.no_grad()
def harvest_game(net, seed: int):
    """Play one full gen23 game; return contract snapshots with gen23's
    real outcome + candidate outcomes in the same worlds."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    snaps = []   # (g0 clone, declarer, hand_number)
    choices = {}  # hand_number -> (discard, trump)
    while not env.done:
        s, dt, cands = env.decision()
        a = model_choose(net, "cpu", env, s, dt, cands)
        if dt == D_TRUMP and env.trump_intent is None and \
                env.g.phase == WIDOW:
            g0 = env.g.clone()
            hn = env.g.hand_number
            env.apply(a)
            picks = []
            while env.g.phase == WIDOW:
                s2, dt2, cd = env.decision()
                p = model_choose(net, "cpu", env, s2, dt2, cd)
                picks.append(p)
                env.apply(p)
            snaps.append((g0, s, hn))
            choices[hn] = (picks, a)
            continue
        env.apply(a)

    hist = {h[0]: h for h in env.g.hand_history}
    rows = []
    for g0, declarer, hn in snaps:
        h = hist.get(hn)
        if h is None:
            continue
        team = team_of(declarer)
        own_made = not h[6]
        own_score = int(h[4] if team == 0 else h[5])
        disc, trump = choices[hn]
        hand13 = sorted(g0.hands[declarer])
        cands_out = []
        for cdisc, ctrump in candidate_menu(hand13, disc, trump):
            made, score = rollout(g0, declarer, cdisc, ctrump, net)
            cands_out.append(dict(d=sorted(cdisc), t=ctrump,
                                  m=int(made), s=score, adv=score - own_score))
        rows.append(dict(
            seed=seed, hn=hn, declarer=declarer, bid=int(g0.high_bid),
            hand=hand13, dealer=g0.dealer,
            scores=[int(g0.scores[team]), int(g0.scores[1 - team])],
            own=dict(d=sorted(disc), t=trump, m=int(own_made), s=own_score),
            cands=cands_out))
    return rows


def worker(worker_id: int, args):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    os.makedirs(args.out, exist_ok=True)
    existing = len(glob.glob(os.path.join(args.out,
                                          f"w{worker_id}_*.jsonl")))
    shard_n = existing
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000 + existing * 5_000
    contracts = 0
    while time.time() < t_end:
        path = os.path.join(args.out, f"w{worker_id}_{shard_n:04d}.jsonl")
        tmp = path + ".tmp"
        n_in_shard = 0
        with open(tmp, "w") as f:
            while n_in_shard < CONTRACTS_PER_SHARD and time.time() < t_end:
                seed += 1
                for row in harvest_game(net, seed):
                    f.write(json.dumps(row) + "\n")
                    n_in_shard += 1
                    contracts += 1
        os.replace(tmp, path)
        shard_n += 1
        if worker_id == 0:
            print(f"  [w0] shard {shard_n}, ~{contracts} contracts/worker, "
                  f"{(t_end - time.time()) / 60:.0f} min left", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--seed-base", type=int, default=3_000_000_000)
    args = ap.parse_args()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"widow gym corpus: {args.workers} workers, {args.minutes} min "
          f"-> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("WIDOWGYM RUN DONE", flush=True)


if __name__ == "__main__":
    main()
