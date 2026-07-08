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
from .encoder import encode_state, encode_action, D_DISCARD, D_PLAY
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
def play_arena_game(net, device, model_team: int, opponent: str, seed: int,
                    script_dtypes: frozenset = frozenset()):
    """Returns (model_won, score_diff_for_model, hands). Decision types in
    script_dtypes are handled by the family heuristic even on the net's team
    (curriculum stages — mirrors how TS AlphaRook phase 1 was measured)."""
    net.eval()
    env = SelfPlayGame(seed)
    rng = random.Random(seed ^ 0x5EED)
    styles = [opponent] * 4
    pending_gd: list[int] = []
    while not env.done:
        seat, dtype, cands = env.decision()
        net_decides = (team_of(seat) == model_team
                       and dtype not in script_dtypes)
        if net_decides:
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

    # Role split — the four "mental models" of the family game, team view:
    # hands where the net's team held the contract (declarer + partner
    # chairs) vs hands where it defended (the before/after-declarer chairs;
    # the net sees its position via the bid-winner-relative encoding).
    roles = {"decl_hands": 0, "decl_made": 0, "decl_bid_sum": 0,
             "def_hands": 0, "def_sets": 0, "def_pts": 0}
    for h in env.g.hand_history:
        went_set = h[6]
        net_delta = h[4] if model_team == 0 else h[5]
        if team_of(h[1]) == model_team:
            roles["decl_hands"] += 1
            roles["decl_made"] += 0 if went_set else 1
            roles["decl_bid_sum"] += h[2]
        else:
            roles["def_hands"] += 1
            roles["def_sets"] += 1 if went_set else 0
            roles["def_pts"] += net_delta
    return env.g.winner == model_team, diff, len(env.g.hand_history), roles


def arena(net, device, opponent: str, n_games: int, seed: int = 0,
          script_dtypes: frozenset = frozenset()):
    wins, diffs, hands = 0, [], 0
    roles = {"decl_hands": 0, "decl_made": 0, "decl_bid_sum": 0,
             "def_hands": 0, "def_sets": 0, "def_pts": 0}
    for i in range(n_games):
        won, diff, h, r = play_arena_game(net, device, i % 2, opponent,
                                          seed + i * 977, script_dtypes)
        wins += 1 if won else 0
        diffs.append(diff)
        hands += h
        for k in roles:
            roles[k] += r[k]
    n = max(1, n_games)
    dh, fh = max(1, roles["decl_hands"]), max(1, roles["def_hands"])
    return {
        "opponent": opponent,
        "games": n_games,
        "win_rate": wins / n,
        "avg_diff": sum(diffs) / n,
        "avg_hands": hands / n,
        # role report: contract-holding vs defending
        "decl_hands": roles["decl_hands"],
        "decl_make_rate": round(roles["decl_made"] / dh, 3),
        "decl_avg_bid": round(roles["decl_bid_sum"] / dh, 1),
        "def_hands": roles["def_hands"],
        "def_set_rate": round(roles["def_sets"] / fh, 3),
        "def_avg_pts": round(roles["def_pts"] / fh, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--opponent", default="basic",
                    choices=["random", "basic", "aggressive", "cautious"])
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--script", default="none",
                    choices=["openings", "bid", "none"],
                    help="decisions the family heuristic makes for the net's "
                         "team too (curriculum-stage evals)")
    args = ap.parse_args()

    net = QNet()
    state = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    net.load_state_dict(state["model"] if "model" in state else state)
    net.to(args.device)
    from .selfplay import SCRIPT_MODES
    r = arena(net, args.device, args.opponent, args.games, args.seed,
              SCRIPT_MODES[args.script])
    print(f"vs {r['opponent']}: {r['win_rate']:.1%} over {r['games']} games "
          f"(avg score diff {r['avg_diff']:+.1f}, avg hands {r['avg_hands']:.1f})")
    print(f"  holding the contract: {r['decl_hands']} hands, "
          f"made {r['decl_make_rate']:.0%} at avg bid {r['decl_avg_bid']}")
    print(f"  defending: {r['def_hands']} hands, set them {r['def_set_rate']:.0%}, "
          f"stole {r['def_avg_pts']:.0f} pts/hand")


if __name__ == "__main__":
    main()
