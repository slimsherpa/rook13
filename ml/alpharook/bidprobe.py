"""gen24 curiosity probe: same hand, different situation — what do they bid?

Riley's actual question. A fixed panel of dealt hands (stratified weak →
monster) is shown to every bidder under a grid of score states and auction
contexts, and each bot's exact bid is recorded. Genome bidders are
deterministic, so this is a complete behavioral X-ray: how much more does
the champion stretch at 270-430 than at a tied table? Does anyone jump
straight to 100 with a monster, or crawl? What happens on the -250 cliff?

    ~/torch-env/bin/python -m alpharook.bidprobe

Probes every city champion + the two anchors; writes
runs/gen24/probe/probe_NNN.json for the artifact.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import time

import torch

from rook.cards import PASS, VALID_BIDS, create_deck
from rook.engine import Game, BIDDING
from rook.bots import estimate_tricks
from .bidcity import CULTURES
from .bidcup import load_champion
from .bidgenes import default_genome, genome_bid
from .encoder import D_BID
from .arena import model_choose
from .model import load_qnet

# (name, target_position 0-3, prefix bids applied from the opening speaker)
# Position p means p speakers act before you; seat is fixed at 0 and the
# dealer is chosen so the auction reaches you exactly after the prefix.
SCENARIOS = [
    ("opener", 0, []),                    # first to speak
    ("after_opp_70", 1, [70]),            # RHO opponent opened 70
    ("after_opp_100", 1, [100]),          # RHO opponent jumped to 100
    ("partner_opened_75", 2, [75, PASS]),  # partner 75, RHO passed
    ("partner_holds_70", 3, [PASS, 70, PASS]),  # raise your own partner?
    ("war_floor_85", 0, [70, 75, PASS, 80]),    # you opened 70; it came back
    ("squeeze_95", 1, [95]),              # RHO opened with a 95 hammer
]

# (label, my_score, opp_score)
SCORE_STATES = [
    ("fresh_0_0", 0, 0),
    ("mid_250_250", 250, 250),
    ("ahead_430_270", 430, 270),
    ("behind_270_430", 270, 430),
    ("race_460_460", 460, 460),
    ("cliff_-180_150", -180, 150),
    ("opp_cliff_150_-180", 150, -180),
    ("desperate_-200_430", -200, 430),
    ("coast_430_-200", 430, -200),
]

SEAT = 0  # the probed bidder always sits seat 0 (team 0)


def build_panel(n_per_bin: int = 15, seed: int = 13):
    """Stratified hands by estimate_tricks: junk / thin / decent / monster."""
    bins = [(0.0, 1.5), (1.5, 2.5), (2.5, 4.0), (4.0, 99.0)]
    panel: list[dict] = []
    counts = [0] * len(bins)
    rng = random.Random(seed)
    tries = 0
    while sum(counts) < n_per_bin * len(bins) and tries < 200_000:
        tries += 1
        deck = create_deck()
        rng.shuffle(deck)
        g = Game(dealer=0)
        g.deal(deck)
        if g.phase != BIDDING:
            continue  # redeal hand
        t = estimate_tricks(g.hands[SEAT])
        for b, (lo, hi) in enumerate(bins):
            if lo <= t < hi and counts[b] < n_per_bin:
                counts[b] += 1
                panel.append(dict(deck=deck, hand=sorted(g.hands[SEAT]),
                                  tricks=round(t, 2), bin=b))
                break
    return panel


def make_state(deck: list[int], scenario, my: int, opp: int) -> Game | None:
    """Fabricate a live bidding state where it is seat 0's turn."""
    _, position, prefix = scenario
    dealer = (SEAT - 1 - position) % 4
    g = Game(dealer=dealer)
    g.deal(list(deck))
    if g.phase != BIDDING:
        return None
    g.scores = [my, opp]
    for bid in prefix:
        g.bid(g.turn, bid)
    assert g.turn == SEAT and g.phase == BIDDING
    return g


class _FakeEnv:
    """Just enough of SelfPlayGame for arena.model_choose."""

    def __init__(self, g: Game):
        self.g = g
        self.picks: list[int] = []
        self.trump_intent = None


@torch.no_grad()
def probe_bot(genome, net, panel) -> list[list[int]]:
    """Returns bids[hand_idx][scenario_idx * len(SCORE_STATES) + score_idx].
    PASS is 0; -1 marks an unreachable state (never happens today)."""
    out = []
    for p in panel:
        row = []
        for scen in SCENARIOS:
            for _label, my, opp in SCORE_STATES:
                g = make_state(p["deck"], scen, my, opp)
                if g is None:
                    row.append(-1)
                    continue
                if genome is not None:
                    row.append(int(genome_bid(g, SEAT, genome)))
                else:
                    floor = g.min_next_bid()
                    cands = [b for b in VALID_BIDS if b >= floor]
                    if not g.must_bid():
                        cands = [PASS] + cands
                    row.append(int(model_choose(net, "cpu", _FakeEnv(g),
                                                SEAT, D_BID, cands)))
        out.append(row)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default="runs/gen24")
    ap.add_argument("--per-bin", type=int, default=15)
    args = ap.parse_args()

    torch.set_num_threads(1)
    probe_dir = os.path.join(args.out, "probe")
    os.makedirs(probe_dir, exist_ok=True)
    n = len(glob.glob(os.path.join(probe_dir, "probe_*.json"))) + 1

    bots = [("family", default_genome(), None),
            ("gen23", None, None)]
    for city in CULTURES:
        champ = load_champion(args.out, city)
        if champ:
            bots.append((champ["name"], champ["genome"], champ["season"]))

    net = load_qnet(args.net)
    panel = build_panel(n_per_bin=args.per_bin)
    t0 = time.time()
    results = {}
    genomes = {}
    for name, genome, season in bots:
        results[name] = probe_bot(genome, net, panel)
        if genome is not None:
            genomes[name] = genome
        print(f"  probed {name} ({time.time() - t0:.0f}s)", flush=True)

    out = dict(
        probe=n, ts=time.time(),
        scenarios=[dict(name=s[0], position=s[1], prefix=s[2])
                   for s in SCENARIOS],
        scores=[dict(label=l, my=m, opp=o) for l, m, o in SCORE_STATES],
        panel=[{k: p[k] for k in ("hand", "tricks", "bin")} for p in panel],
        genomes=genomes,
        results=results,
        seasons={name: season for name, _g, season in bots
                 if season is not None},
    )
    path = os.path.join(probe_dir, f"probe_{n:03d}.json")
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"  -> {path} ({len(panel)} hands x {len(SCENARIOS)} scenarios "
          f"x {len(SCORE_STATES)} scores x {len(bots)} bots)")


if __name__ == "__main__":
    main()
