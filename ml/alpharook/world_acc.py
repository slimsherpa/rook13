"""gen16 pre-flight: are belief-sampled worlds actually TRUER than uniform?

Before a single duel burns compute, measure the thing the whole rung rests
on: per-card placement accuracy of imagined worlds against the real deal.
Drives full games with a reflex policy (all four seats), and at every
multi-candidate decision samples M uniform worlds and M belief-guided
worlds, scoring each hidden card's sampled holder against the truth
(`belief_target`'s convention, mask and all). Also reports the oracle's
own argmax accuracy — the ceiling the sampler is chasing — and the uniform
chance floor, bucketed by phase and trick.

    python -m alpharook.world_acc --policy models/gen13.pt \
        --belief runs/gen15/best_duel.pt --games 20 --worlds 8

Go / no-go: if belief-guided worlds don't beat uniform by several points
(and clearly track the oracle's accuracy curve), fix the sampler before
dreaming about duels.
"""

from __future__ import annotations

import argparse
import random
from collections import defaultdict

import numpy as np
import torch

from rook.cards import SEATS
from rook.determinize import sample_world, sample_world_weighted
from rook.engine import BIDDING, WIDOW, TRUMP, PLAYING
from rook.observation import observe
from .arena import model_choose
from .beliefs import BeliefOracle
from .env import SelfPlayGame
from .model import load_qnet
from .selfplay import belief_target


def bucket_of(o) -> str:
    if o.phase == BIDDING:
        return "bid"
    if o.phase == WIDOW:
        return "widow"
    if o.phase == TRUMP:
        return "trump"
    return f"t{len(o.completed_tricks) + 1}"


BUCKETS = ["bid", "widow", "trump"] + [f"t{i}" for i in range(1, 10)]


def world_to_classes(o, hands, go_down) -> np.ndarray:
    """A sampled world in belief-class form: cls[card] = 0/1/2 relative
    seat, 3 = hidden widow/go-down, -1 = visible to the observer."""
    cls = np.full(40, -1, dtype=np.int8)
    for s in SEATS:
        if s == o.seat:
            continue
        r = (s - o.seat) % 4 - 1
        for c in hands[s]:
            cls[c] = r
    for c in go_down:
        cls[c] = 3
    return cls


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", default="models/gen13.pt",
                    help="reflex net that plays all four seats")
    ap.add_argument("--belief", default="runs/gen15/best_duel.pt",
                    help="gen15+ checkpoint providing the belief head")
    ap.add_argument("--games", type=int, default=20)
    ap.add_argument("--worlds", type=int, default=8,
                    help="worlds sampled per method per decision")
    ap.add_argument("--temp", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    policy = load_qnet(args.policy)
    oracle = BeliefOracle(args.belief, temp=args.temp)
    rng = random.Random(args.seed)

    # bucket -> [sum_acc, n] for each method
    acc = {m: defaultdict(lambda: [0.0, 0])
           for m in ("uniform", "belief", "oracle")}

    for gi in range(args.games):
        env = SelfPlayGame(seed=args.seed + gi * 7919 + 1)
        while not env.done:
            seat, dtype, cands = env.decision()
            if len(cands) > 1:
                o = observe(env.g, seat)
                truth, mask = belief_target(env.g, seat)
                idx = np.flatnonzero(mask)
                if idx.size:
                    b = bucket_of(o)
                    probs = oracle.posterior(env, seat, o, dtype, cands)
                    a = acc["oracle"][b]
                    a[0] += float((probs[idx].argmax(1) == truth[idx]).mean())
                    a[1] += 1
                    for method, sampler in (
                            ("uniform", lambda: sample_world(o, rng)),
                            ("belief", lambda: sample_world_weighted(
                                o, rng, probs))):
                        hit = n = 0
                        for _ in range(args.worlds):
                            hands, gd = sampler()
                            cls = world_to_classes(o, hands, gd)
                            hit += int((cls[idx] == truth[idx]).sum())
                            n += idx.size
                        a = acc[method][b]
                        a[0] += hit / n
                        a[1] += 1
            action = model_choose(policy, "cpu", env, seat, dtype, cands)
            env.apply(action)
        print(f"  game {gi + 1}/{args.games} done", flush=True)

    print(f"\nWorld placement accuracy ({args.games} games, "
          f"{args.worlds} worlds/method/decision, temp {args.temp:g}):")
    print(f"{'bucket':>7} {'n':>6} {'uniform':>9} {'belief':>9} "
          f"{'oracle':>9} {'lift':>7}")
    for b in BUCKETS:
        n = acc["uniform"][b][1]
        if not n:
            continue
        u = acc["uniform"][b][0] / n
        w = acc["belief"][b][0] / max(1, acc["belief"][b][1])
        o_ = acc["oracle"][b][0] / max(1, acc["oracle"][b][1])
        print(f"{b:>7} {n:>6} {u:>9.1%} {w:>9.1%} {o_:>9.1%} {w - u:>+7.1%}")
    tot = {m: (sum(v[0] for v in acc[m].values()),
               sum(v[1] for v in acc[m].values())) for m in acc}
    print(f"{'ALL':>7} {tot['uniform'][1]:>6} "
          f"{tot['uniform'][0] / tot['uniform'][1]:>9.1%} "
          f"{tot['belief'][0] / tot['belief'][1]:>9.1%} "
          f"{tot['oracle'][0] / tot['oracle'][1]:>9.1%} "
          f"{tot['belief'][0] / tot['belief'][1] - tot['uniform'][0] / tot['uniform'][1]:>+7.1%}")


if __name__ == "__main__":
    main()
