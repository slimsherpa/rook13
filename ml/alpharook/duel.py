"""The champion's ladder: two agents, identical deals, swapped seats.

Riley's benchmark design: every pair of games uses the SAME pre-generated
deck sequence and the same first dealer — only the teams swap chairs. Deal
luck cancels out, so a pair won 2-0 is real signal ("swept"), 1-1 is a
wash. Agents are feedforward and stateless across games, so a repeated
deal cannot be "remembered" — only played better.

Each side is a checkpoint (or a heuristic style like `basic`) plus a script
mode saying which decisions the family heuristic still makes for it. That
lets bidding STYLES fight directly: e.g. gen7's learned bidding (--script-a
godown) vs gen6 with the family's scripted bidding (--script-b openings),
both using their learned card play.

    python -m alpharook.duel --a models/gen7.pt --script-a godown \
        --b runs/gen6/latest.pt --script-b openings --pairs 100
"""

from __future__ import annotations

import argparse
import random

import torch

from rook.cards import team_of, create_deck
from rook.bots import next_bot_action
from .encoder import D_DISCARD
from .env import SelfPlayGame
from .model import QNet
from .selfplay import SCRIPT_MODES
from .arena import model_choose


class Side:
    """One competitor: a QNet checkpoint or a heuristic bot style."""

    def __init__(self, spec: str, script: str):
        self.spec = spec
        self.script = SCRIPT_MODES[script]
        self.net = None
        self.style = None
        if spec in ("random", "basic", "aggressive", "cautious"):
            self.style = spec
        else:
            self.net = QNet()
            ck = torch.load(spec, map_location="cpu", weights_only=True)
            self.net.load_state_dict(ck["model"] if "model" in ck else ck)
            self.net.eval()

    def name(self) -> str:
        return self.spec.split("/")[-1]


def deck_stream(pair_seed: int):
    def deck_fn(i: int) -> list[int]:
        deck = create_deck()
        random.Random(pair_seed * 1_000_003 + i * 7919).shuffle(deck)
        return deck
    return deck_fn


@torch.no_grad()
def play_duel_game(side0: Side, side1: Side, pair_seed: int, flip: bool):
    """side0 is team A unless flip. Returns (winning_side_idx, diff_for_side0,
    per-side auction stats)."""
    sides = [side1, side0] if flip else [side0, side1]  # index by team
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4)
    rng = random.Random(pair_seed ^ 0xD0E1)
    pending: dict[int, list[int]] = {0: [], 1: []}
    heur_styles = ["basic"] * 4

    while not env.done:
        seat, dtype, cands = env.decision()
        team = team_of(seat)
        side = sides[team]
        scripted = dtype in side.script or side.style is not None
        if not scripted:
            action = model_choose(side.net, "cpu", env, seat, dtype, cands)
        elif dtype == D_DISCARD:
            if not pending[team]:
                styles = [side.style or "basic"] * 4
                _, _, cards = next_bot_action(env.g, styles, rng)
                pending[team] = list(cards)
            action = pending[team].pop(0)
        else:
            styles = [side.style or "basic"] * 4
            _, _, action = next_bot_action(env.g, styles, rng)
        env.apply(action)

    s = env.g.scores
    team_of_side0 = 1 if flip else 0
    diff0 = s[team_of_side0] - s[1 - team_of_side0]
    winner_side = 0 if env.g.winner == team_of_side0 else 1

    stats = {0: dict(contracts=0, made=0, bid_sum=0),
             1: dict(contracts=0, made=0, bid_sum=0)}
    for h in env.g.hand_history:
        side_idx = 0 if team_of(h[1]) == team_of_side0 else 1
        stats[side_idx]["contracts"] += 1
        stats[side_idx]["made"] += 0 if h[6] else 1
        stats[side_idx]["bid_sum"] += h[2]
    return winner_side, diff0, stats


def duel(side_a: Side, side_b: Side, n_pairs: int, seed: int = 0):
    a_wins = b_wins = sweeps_a = sweeps_b = 0
    diffs = []
    auct = {0: dict(contracts=0, made=0, bid_sum=0),
            1: dict(contracts=0, made=0, bid_sum=0)}
    for p in range(n_pairs):
        pair_seed = seed + p * 104729 + 1
        results = []
        for flip in (False, True):
            w, d, st = play_duel_game(side_a, side_b, pair_seed, flip)
            results.append(w)
            diffs.append(d)
            for i in (0, 1):
                for k in auct[i]:
                    auct[i][k] += st[i][k]
            if w == 0:
                a_wins += 1
            else:
                b_wins += 1
        if results == [0, 0]:
            sweeps_a += 1
        elif results == [1, 1]:
            sweeps_b += 1

    games = 2 * n_pairs
    print(f"{side_a.name()} vs {side_b.name()} — {n_pairs} deal-pairs "
          f"({games} games, duplicate decks, seats swapped):")
    print(f"  {side_a.name()}: {a_wins / games:.1%} wins "
          f"(avg diff {sum(diffs) / games:+.1f})")
    print(f"  pairs swept: {side_a.name()} {sweeps_a}, {side_b.name()} "
          f"{sweeps_b}, split {n_pairs - sweeps_a - sweeps_b}")
    for i, side in ((0, side_a), (1, side_b)):
        c = max(1, auct[i]["contracts"])
        print(f"  {side.name()} auctions: won {auct[i]['contracts']} contracts, "
              f"made {auct[i]['made'] / c:.0%} at avg bid "
              f"{auct[i]['bid_sum'] / c:.1f}")
    return a_wins / games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="checkpoint path or bot style")
    ap.add_argument("--b", required=True)
    ap.add_argument("--script-a", default="godown",
                    choices=list(SCRIPT_MODES))
    ap.add_argument("--script-b", default="godown",
                    choices=list(SCRIPT_MODES))
    ap.add_argument("--pairs", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    duel(Side(args.a, args.script_a), Side(args.b, args.script_b),
         args.pairs, args.seed)


if __name__ == "__main__":
    main()
