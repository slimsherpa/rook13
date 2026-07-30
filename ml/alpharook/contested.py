"""Contested-deal mining (Riley's curriculum idea, 2026-07-25, gen22 era).

The hand-pair decomposition proved ~74% of Rook hands are decided by the
cards no matter who holds them; the whole gen21-vs-world edge lives in the
other ~26%. Training on slam dunks muddies the gradient with rows whose
outcome no decision could change — this module finds the hands where PLAY
matters, so the Darwin gym can feed its fighters a curriculum weighted
toward skill-decided deals (and exams that measure 3-4x more per game).

Contestability of a deal is measured by DITHER: gen21 plays the single hand
K times in all four seats with softmax-temperature action sampling. If
every noisy playout lands the same score swing, the hand was in the cards
(laydowns score ~0 spread — including the ones only sloppy defense lets
through, because the dither TRIES the sloppy defenses). If small deviations
swing the outcome, the hand is contested. Score = std of the team-0 hand
swing across playouts, plus the flip rate (how often the winning TEAM
differs from the modal winner).

    python -m alpharook.contested --net models/gen21-cand1.pt \
        --out runs/decks/lib.jsonl --deals 24000 --k 8 --temp 0.04 \
        --seed-base 0 --workers 7

Output: one JSON line per deal {seed, dealer, mean, std, flip, dev}
(dev = fraction of dithered decisions that differed from argmax — the
knob check for --temp). Deals that hit an engine redeal are recorded with
"redeal": true and skipped by consumers. The library is APPEND-friendly:
re-running with the same --out resumes after the existing line count.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from rook.cards import create_deck
from rook.observation import observe
from .encoder import encode_state_for, encode_action

DECK_SALT = 0x5EED_C0DE


def deal_deck(deal_seed: int) -> list[int]:
    """The canonical deal for a library seed — every consumer (scorer, gym,
    exams, world cup) reconstructs the identical 40-card order from the
    seed alone, so the library stores integers, not decks."""
    deck = create_deck()
    random.Random(deal_seed ^ DECK_SALT).shuffle(deck)
    return deck


def dither_pick(net, env, seat, dtype, cands, temp: float, rng) -> tuple[int, bool]:
    """Sample among candidates by softmax(Q/temp). Returns (index, deviated
    from argmax?). temp<=0 = pure argmax."""
    if len(cands) == 1:
        return 0, False
    s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                         env.g, env.trump_intent)
    S = torch.from_numpy(np.stack([s] * len(cands)))
    A = torch.from_numpy(np.stack([encode_action(dtype, a) for a in cands]))
    with torch.no_grad():
        q = net(S, A).numpy().astype(np.float64)
    best = int(q.argmax())
    if temp <= 0:
        return best, False
    z = (q - q.max()) / temp
    p = np.exp(z)
    p /= p.sum()
    j = int(rng.choices(range(len(cands)), weights=p)[0])
    return j, j != best


def play_one_hand(net, deal_seed: int, temp: float, rng):
    """Play a single hand (all four seats = net, dithered). Returns
    (team0_swing, n_decisions, n_deviations) or None on engine redeal."""
    from .env import SelfPlayGame
    deck0 = deal_deck(deal_seed)

    def deck_fn(i: int):
        if i == 0:
            return deck0
        # escape hatch: is_redeal_hand fires AT DEAL TIME, and re-serving
        # the identical deck would spin _advance forever (froze the first
        # fleet build at deal ~1-in-6k). Any different deck frees the
        # engine; deal_count > 1 below then flags the deal as a skip.
        d = list(deck0)
        random.Random(deal_seed ^ (i * 0x9E3779B1)).shuffle(d)
        return d

    env = SelfPlayGame(seed=deal_seed, dealer=deal_seed % 4,
                       deck_fn=deck_fn,
                       win_score=10 ** 9, lose_score=-10 ** 9)
    dec = dev = 0
    while not env.done and not env.g.hand_history:
        if env.deal_count > 1:
            return None  # engine redeal fired: not a scorable library deal
        seat, dtype, cands = env.decision()
        j, d = dither_pick(net, env, seat, dtype, cands, temp, rng)
        dec += 1
        dev += 1 if d else 0
        env.apply(cands[j])
    h = env.g.hand_history[0]
    return float(h[4] - h[5]), dec, dev


def score_deal(net, deal_seed: int, k: int, temp: float) -> dict:
    swings, dec = [], [0, 0]
    for i in range(k):
        rng = random.Random(deal_seed * 1_000_003 + i * 97 + 13)
        r = play_one_hand(net, deal_seed, temp, rng)
        if r is None:
            return {"seed": deal_seed, "redeal": True}
        swings.append(r[0])
        dec[0] += r[1]
        dec[1] += r[2]
    a = np.array(swings)
    signs = np.sign(a)
    modal = 1.0 if (signs > 0).sum() >= (signs < 0).sum() else -1.0
    flip = float((signs != modal).mean())
    return {"seed": deal_seed, "dealer": deal_seed % 4,
            "mean": round(float(a.mean()), 1),
            "std": round(float(a.std()), 1),
            "flip": round(flip, 3),
            "dev": round(dec[1] / max(1, dec[0]), 3)}


# --- contest score + tiers (shared by every consumer) ----------------------

def contest_score(rec: dict) -> float:
    """One number for the sliding scale: swing spread + a bonus for deals
    where the dither actually flips who WINS the hand (200 ~ one flipped
    120-point hand plus set delta)."""
    return rec["std"] + 200.0 * rec["flip"]


def load_library(path: str, exam_mod: int = 10):
    """Returns (train_tiers, exam_tiers, stats): each tiers = [t0, t1, t2]
    lists of deal seeds — t0 = calmest quartile (cards-decided), t1 = middle
    half, t2 = most contested quartile. Deals with seed % exam_mod == 7 are
    held out for exams/world cups; the gym never trains on them."""
    recs = []
    with open(path) as f:
        for line in f:
            r = json.loads(line)
            if not r.get("redeal"):
                recs.append(r)
    if len(recs) < 100:
        raise SystemExit(f"library {path} too small ({len(recs)} deals)")
    scores = np.array([contest_score(r) for r in recs])
    q25, q75 = np.percentile(scores, [25, 75])

    def tier(s):
        return 0 if s <= q25 else (2 if s >= q75 else 1)

    train = [[], [], []]
    exam = [[], [], []]
    for r, s in zip(recs, scores):
        (exam if r["seed"] % exam_mod == 7 else train)[tier(s)].append(r["seed"])
    stats = {"deals": len(recs), "q25": round(float(q25), 1),
             "q75": round(float(q75), 1),
             "train": [len(t) for t in train], "exam": [len(t) for t in exam]}
    return train, exam, stats


class CuratedDecks:
    """deck_fn factory over a tier library. For a pair_seed, both games of
    the duplicate pair get the identical curated deal sequence; tier_of
    exposes each deal index's tier for skill-share accounting."""

    def __init__(self, tiers, weights: tuple[float, float, float]):
        self.tiers = [t for t in tiers]
        w = np.array(weights, dtype=np.float64)
        # a tier with no deals can't be sampled
        for i in range(3):
            if not self.tiers[i]:
                w[i] = 0.0
        self.weights = (w / w.sum()).tolist()

    def deck_fn_for(self, pair_seed: int):
        rng = random.Random(pair_seed ^ 0xDA12)
        seq: dict[int, tuple[int, int]] = {}

        def pick(i: int):
            if i not in seq:
                t = rng.choices((0, 1, 2), weights=self.weights)[0]
                seq[i] = (t, rng.choice(self.tiers[t]))
            return seq[i]

        def deck_fn(i: int):
            return deal_deck(pick(i)[1])

        def tier_of(i: int) -> int:
            return pick(i)[0]

        return deck_fn, tier_of


# --- CLI: build / extend a library -----------------------------------------

def _winit(net_path: str):
    torch.set_num_threads(1)
    from .model import load_qnet
    global _NET
    _NET = load_qnet(net_path)


def _wscore(args):
    deal_seed, k, temp = args
    return score_deal(_NET, deal_seed, k, temp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--deals", type=int, default=24000)
    ap.add_argument("--k", type=int, default=8,
                    help="dithered playouts per deal")
    ap.add_argument("--temp", type=float, default=0.2,
                    help="softmax temperature over Q (calibrated 2026-07-25:"
                         " dev ~0.11, a third of deals dither-proof)")
    ap.add_argument("--seed-base", type=int, default=0,
                    help="disjoint per box: box B uses B*10,000,000")
    ap.add_argument("--workers", type=int, default=7)
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = 0
    if out.exists():
        with open(out) as f:
            done = sum(1 for _ in f)
    todo = [args.seed_base + i for i in range(done, args.deals)]
    if not todo:
        print(f"{out}: already has {done} deals")
        return
    print(f"{out}: {done} scored, {len(todo)} to go "
          f"(k={args.k}, temp={args.temp})")

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    t0 = time.time()
    n = devs = 0
    with ctx.Pool(args.workers, initializer=_winit,
                  initargs=(args.net,)) as pool, open(out, "a") as f:
        for rec in pool.imap(_wscore, ((s, args.k, args.temp) for s in todo),
                             chunksize=8):
            f.write(json.dumps(rec) + "\n")
            n += 1
            if not rec.get("redeal"):
                devs += rec["dev"]
            if n % 500 == 0:
                f.flush()
                rate = n / (time.time() - t0)
                print(f"  {done + n}/{args.deals} "
                      f"({rate:.1f} deals/s, dev {devs / n:.2f})", flush=True)
    print(f"done: {done + n} deals in {out}")


if __name__ == "__main__":
    main()
