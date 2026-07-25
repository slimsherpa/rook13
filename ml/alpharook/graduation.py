"""gen20 graduation: the COMPOSITE bot plays full games, bidding included.

The composite is Riley's four specialists seated as one player: gen13 bids
the auction (bidding was never trained in the gym); the moment the auction
resolves, every seat knows its role relative to the bid winner and the
matching specialist net takes over — taker, partner, left, right. Pure
reflex on all sides: this exam asks whether the gym's lessons stuck in
instinct and whether points-per-hand converts into WON GAMES.

    python -m alpharook.graduation --taker runs/hot-taker/best_battery.pt \
        --partner runs/hot-partner/best_battery.pt \
        --left runs/hot-left-r2/best_battery.pt \
        --right runs/hot-right-r2/best_battery.pt \
        --pairs 150 --workers 7
"""

from __future__ import annotations

import argparse
import time

import numpy as np
import torch

from rook.cards import team_of
from rook.engine import BIDDING
from rook.observation import observe
from .encoder import encode_state_for, encode_action
from .env import SelfPlayGame
from .model import load_qnet
from .duel import deck_stream

ROLE_NAMES = ("taker", "left", "partner", "right")


def reflex(net, env, seat, dtype, cands) -> int:
    s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                         env.g, env.trump_intent)
    S = torch.from_numpy(np.stack([s] * len(cands)))
    A = torch.from_numpy(np.stack([encode_action(dtype, a) for a in cands]))
    with torch.no_grad():
        q = net(S, A)
    return int(q.argmax().item())


class Composite:
    """gen13 bids; after the auction the role specialist plays the seat."""

    def __init__(self, bidder, specialists: dict):
        self.bidder = bidder
        self.specialists = specialists  # role name -> net

    def pick(self, env, seat, dtype, cands) -> int:
        g = env.g
        if g.phase == BIDDING or g.bid_winner is None:
            return reflex(self.bidder, env, seat, dtype, cands)
        role = ROLE_NAMES[(seat - g.bid_winner) % 4]
        return reflex(self.specialists[role], env, seat, dtype, cands)


@torch.no_grad()
def play_game(composite, opponent, pair_seed: int, flip: bool,
              win_score: int = 500):
    """Composite is team A unless flip; opponent plays every seat reflex."""
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4,
                       win_score=win_score, lose_score=-win_score // 2)
    comp_team = 1 if flip else 0
    while not env.done:
        seat, dtype, cands = env.decision()
        if team_of(seat) == comp_team:
            j = composite.pick(env, seat, dtype, cands)
        else:
            j = reflex(opponent, env, seat, dtype, cands)
        env.apply(cands[j])
    s = env.g.scores
    diff = s[comp_team] - s[1 - comp_team]
    return (1 if env.g.winner == comp_team else 0), diff


_W: dict = {}


def _init(args_d):
    torch.set_num_threads(1)
    bidder = load_qnet(args_d["bidder"])
    spec = {r: load_qnet(args_d[r]) for r in ROLE_NAMES}
    _W["comp"] = Composite(bidder, spec)
    _W["opp"] = load_qnet(args_d["opponent"])
    _W["win"] = args_d["win_score"]


def _pair(pair_seed: int):
    out = []
    for flip in (False, True):
        out.append(play_game(_W["comp"], _W["opp"], pair_seed, flip,
                             _W["win"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--taker", required=True)
    ap.add_argument("--partner", required=True)
    ap.add_argument("--left", required=True)
    ap.add_argument("--right", required=True)
    ap.add_argument("--bidder", default="models/gen13.pt")
    ap.add_argument("--opponent", default="models/gen13.pt")
    ap.add_argument("--pairs", type=int, default=150)
    ap.add_argument("--win-score", type=int, default=500)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=7)
    args = ap.parse_args()

    args_d = dict(bidder=args.bidder, opponent=args.opponent,
                  taker=args.taker, partner=args.partner, left=args.left,
                  right=args.right, win_score=args.win_score)
    seeds = [args.seed + p * 104729 + 1 for p in range(args.pairs)]
    wins = games = sweeps = osweeps = 0
    diffs = []
    t0 = time.time()
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.workers, initializer=_init, initargs=(args_d,)) as pool:
        for res in pool.imap_unordered(_pair, seeds):
            pair_w = 0
            for w, d in res:
                wins += w
                pair_w += w
                games += 1
                diffs.append(d)
            if pair_w == 2:
                sweeps += 1
            elif pair_w == 0:
                osweeps += 1
            done = games
            if done % 20 == 0:
                print(f"  [{done // 2}/{args.pairs} pairs] "
                      f"{wins}-{games - wins} ({wins / done:.1%}), "
                      f"sweeps {sweeps}-{osweeps}, "
                      f"{(time.time() - t0) / done:.1f}s/game", flush=True)
    print(f"COMPOSITE vs {args.opponent} — {args.pairs} pairs "
          f"({games} games, duplicate decks, seats swapped, "
          f"win-score {args.win_score}):")
    print(f"  composite: {wins / games:.1%} wins "
          f"(avg diff {sum(diffs) / games:+.1f})")
    print(f"  pairs swept: composite {sweeps}, opponent {osweeps}, "
          f"split {args.pairs - sweeps - osweeps}")


if __name__ == "__main__":
    main()
