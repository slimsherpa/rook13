"""Head-to-head evaluation: the net (one team) vs heuristic bots (the other),
full games, sides swapped every other game. This is the promotion ladder —
a generation only counts if it beats Standard here.

CLI:  python -m alpharook.arena --ckpt runs/<name>/latest.pt --opponent basic --games 100
"""

from __future__ import annotations

import argparse
import random

import numpy as np
import torch

from rook.cards import team_of
from rook.bots import next_bot_action
from rook.observation import observe
from .encoder import encode_state, encode_action, D_DISCARD
from .env import SelfPlayGame
from .model import QNet


@torch.no_grad()
def model_choose(net, device, env: SelfPlayGame, seat: int, dtype: int, cands: list):
    s = encode_state(observe(env.g, seat), env.picks, dtype, env.g)
    S = torch.from_numpy(np.stack([s] * len(cands))).to(device)
    A = torch.from_numpy(
        np.stack([encode_action(dtype, a) for a in cands])).to(device)
    return cands[int(torch.argmax(net(S, A)).item())]


@torch.no_grad()
def play_arena_game(net, device, model_team: int, opponent: str, seed: int):
    """Returns (model_won, score_diff_for_model, hands)."""
    net.eval()
    env = SelfPlayGame(seed)
    rng = random.Random(seed ^ 0x5EED)
    styles = [opponent] * 4
    pending_gd: list[int] = []
    while not env.done:
        seat, dtype, cands = env.decision()
        if team_of(seat) == model_team:
            action = model_choose(net, device, env, seat, dtype, cands)
        elif dtype == D_DISCARD:
            # heuristic picks its whole go-down at once; feed it card by card
            if not pending_gd:
                _, _, cards = next_bot_action(env.g, styles, rng)
                pending_gd = list(cards)
            action = pending_gd.pop(0)
        else:
            _, _, action = next_bot_action(env.g, styles, rng)
        env.apply(action)

    s = env.g.scores
    diff = s[model_team] - s[1 - model_team]
    return env.g.winner == model_team, diff, len(env.g.hand_history)


def arena(net, device, opponent: str, n_games: int, seed: int = 0):
    wins, diffs, hands = 0, [], 0
    for i in range(n_games):
        won, diff, h = play_arena_game(net, device, i % 2, opponent, seed + i * 977)
        wins += 1 if won else 0
        diffs.append(diff)
        hands += h
    n = max(1, n_games)
    return {
        "opponent": opponent,
        "games": n_games,
        "win_rate": wins / n,
        "avg_diff": sum(diffs) / n,
        "avg_hands": hands / n,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--opponent", default="basic",
                    choices=["random", "basic", "aggressive", "cautious"])
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    net = QNet()
    state = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    net.load_state_dict(state["model"] if "model" in state else state)
    net.to(args.device)
    r = arena(net, args.device, args.opponent, args.games, args.seed)
    print(f"vs {r['opponent']}: {r['win_rate']:.1%} over {r['games']} games "
          f"(avg score diff {r['avg_diff']:+.1f}, avg hands {r['avg_hands']:.1f})")


if __name__ == "__main__":
    main()
