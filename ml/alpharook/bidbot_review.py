"""P2 — the override review: BidBot's disagreements, laid out for human
eyeballs (the WidowMaker-review ritual, transplanted to the auction).

Replays held-out games (seed % 10 == 0 — games the net never trained
on), runs BidBot live at each bid decision, and records every override:
the dealt nine, the auction so far, the score, the house choice, the
net's pick, its claimed winprob swing and daydream score readout. The
JSONL feeds the side-by-side artifact Riley reviews before any flag
flips.

    ~/torch-env/bin/python -m alpharook.bidbot_review \
        --ckpt models/bidbot-v0.pt --games 200 --out runs/p2/review.jsonl
"""

from __future__ import annotations

import argparse
import json

import torch

from rook.cards import PASS, SUIT_NAMES, num_of, suit_of
from .arena import model_choose
from .bidbot import BidBot
from .duel import deck_stream
from .encoder import D_BID
from .env import SelfPlayGame
from .model import load_qnet


def card_str(c: int) -> str:
    return f"{SUIT_NAMES[suit_of(c)][0]}{num_of(c)}"


def hand_str(cards) -> str:
    by_suit: dict[int, list[int]] = {}
    for c in sorted(cards, key=lambda c: (suit_of(c), -num_of(c))):
        by_suit.setdefault(suit_of(c), []).append(c)
    return "  ".join(
        f"{SUIT_NAMES[s]}: {' '.join(str(num_of(c)) for c in cs)}"
        for s, cs in sorted(by_suit.items()))


def bid_str(b) -> str:
    return "pass" if b == PASS else str(b)


@torch.no_grad()
def review_game(net, bot: BidBot, seed: int, out) -> tuple[int, int]:
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    n_bids = n_over = 0
    while not env.done:
        seat, dtype, cands = env.decision()
        if dtype == D_BID:
            house = model_choose(net, "cpu", env, seat, dtype, cands)
            if len(cands) > 1:
                n_bids += 1
                pick, delta, u_house, s_pick = bot.choose_bid(
                    env, seat, cands, house)
                if pick != house:
                    n_over += 1
                    g = env.g
                    out.write(json.dumps(dict(
                        seed=seed, hn=g.hand_number, seat=seat,
                        scores=list(g.scores),
                        hand=hand_str(g.hands[seat]),
                        auction=[[s, bid_str(b)] for s, b in g.bid_history],
                        dealer=g.dealer,
                        house=bid_str(house), pick=bid_str(pick),
                        claimed_dwp=round(delta, 4),
                        daydream_score=round(s_pick * 180),
                    )) + "\n")
            env.apply(house)     # mainline stays the house game
            continue
        env.apply(model_choose(net, "cpu", env, seat, dtype, cands))
    return n_bids, n_over


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="models/bidbot-v0.pt")
    ap.add_argument("--tau", type=float, default=0.05)
    ap.add_argument("--winprob", default="models/winprob25.json")
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed-base", type=int, default=31_000_000_000,
                    help="fresh seeds — never trained on, never twinned")
    ap.add_argument("--out", default="runs/p2/review.jsonl")
    args = ap.parse_args()
    net = load_qnet(args.net)
    net.eval()
    bot = BidBot(args.ckpt, args.winprob, args.tau)
    tb = to = 0
    with open(args.out, "w") as f:
        for i in range(args.games):
            nb, no = review_game(net, bot, args.seed_base + i, f)
            tb += nb
            to += no
    print(f"{args.games} games: {tb} live bid decisions, {to} overrides "
          f"({100 * to / max(tb, 1):.1f}%) -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
