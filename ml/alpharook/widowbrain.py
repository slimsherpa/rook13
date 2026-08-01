"""WidowBrain — the per-hand widow chooser (gen24 Act VI, the bot).

Trained on the widow gym's twin-hand corpus: ~430k contracts where the
same hand was replayed with alternative (go-down, trump) choices and
each labeled with its ADVANTAGE over gen23's actual choice on the
identical cards. "Beat gen23's widow, get rewarded" — Riley's rule,
literally the loss function.

The bot sees ONLY what a player sees: its 13 cards and the bid it owes.
No peeking — the hindsight lives in the training labels, where it
belongs; at play time the net has generalized it into judgment.

At decision time it scores EVERY legal option — all C(13,4)=715
discards x 4 trumps = 2,860 candidates — in a single batch forward
(milliseconds), and takes the argmax. The corpus only ever sampled ~14
options per hand; the net interpolates the rest.

    ~/torch-env/bin/python -m alpharook.widowbrain train
    ~/torch-env/bin/python -m alpharook.widowbrain gate --contracts 3000

Gate: fresh contracts, twin rollouts — WidowBrain's choice vs gen23's
choice on the same hand, paired made%/points. Success = beat the live
search result (+1.36pp) at a fraction of the cost.
"""

from __future__ import annotations

import argparse
import glob
import itertools
import json
import math
import os
import random
import statistics
import time

import numpy as np
import torch
import torch.nn as nn

from rook.cards import SUITS, card_points, num_of, suit_of
from .model import load_qnet

FEAT_DIM = 95
MODEL_PATH = "models/widowbrain-v1.pt"
SHARDS = "runs/gen24/widowgym/shards"


def featurize(hand13, bid, disc, trump):
    """(13 cards, bid) + candidate (discard, trump) -> 95 floats.
    Raw card bits for hand and for the KEPT nine, per-suit aggregates of
    the kept hand relative to the chosen trump, bid level. No hand-crafted
    strategy features — the judgment is the net's to learn."""
    f = np.zeros(FEAT_DIM, dtype=np.float32)
    dset = set(disc)
    kept = [c for c in hand13 if c not in dset]
    for c in hand13:
        f[c] = 1.0
    for c in kept:
        f[40 + c] = 1.0
    i = 80
    f[i + trump] = 1.0
    i += 4
    tcards = [c for c in kept if suit_of(c) == trump]
    f[i] = len(tcards) / 9.0
    f[i + 1] = (max((num_of(c) for c in tcards), default=0)) / 14.0
    f[i + 2] = sum(card_points(c) for c in disc) / 30.0     # buried counters
    off = [s for s in SUITS if s != trump]
    f[i + 3] = sum(1 for s in off
                   if not any(suit_of(c) == s for c in kept)) / 3.0  # voids
    f[i + 4] = sum(1 for s in off
                   if sum(1 for c in kept if suit_of(c) == s) == 1) / 3.0
    f[i + 5] = bid / 120.0
    f[i + 6] = sum(card_points(c) for c in kept) / 100.0
    f[i + 7] = len([c for c in hand13 if suit_of(c) == trump]) / 13.0
    f[i + 8] = 0.0  # reserved
    f[i + 9] = 0.0  # reserved
    f[i + 10] = 0.0  # reserved
    assert i + 11 == FEAT_DIM
    return f


class WidowNet(nn.Module):
    def __init__(self, dim: int = FEAT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


def _shard_arrays(path: str):
    X, Y = [], []
    for line in open(path):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r["cands"] and "k" in r["cands"][0]:
            continue
        hand, bid = r["hand"], r["bid"]
        own = r["own"]
        X.append(featurize(hand, bid, own["d"], own["t"]))
        Y.append(0.0)                       # gen23's own choice: adv 0
        for c in r["cands"]:
            X.append(featurize(hand, bid, c["d"], c["t"]))
            Y.append(c["adv"] / 200.0)      # scale: a full flip ~ +/-1
    if not X:
        return None
    return np.stack(X), np.array(Y, dtype=np.float32)


def train(args):
    shards = sorted(glob.glob(os.path.join(args.shards, "*.jsonl")))
    val = shards[-3:]
    tr = shards[:-3]
    print(f"{len(tr)} train shards, {len(val)} val", flush=True)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    net = WidowNet().to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-5)
    lossf = nn.HuberLoss(delta=0.5)
    vparts = [a for a in (_shard_arrays(p) for p in val) if a]
    Xv = torch.from_numpy(np.concatenate([v[0] for v in vparts])).to(dev)
    Yv = torch.from_numpy(np.concatenate([v[1] for v in vparts])).to(dev)
    print(f"val rows: {len(Yv):,}", flush=True)
    rng = random.Random(7)
    step = 0
    t0 = time.time()
    for epoch in range(args.epochs):
        order = list(tr)
        rng.shuffle(order)
        for sp in order:
            arrs = _shard_arrays(sp)
            if not arrs:
                continue
            X, Y = arrs
            idx = np.random.permutation(len(Y))
            X, Y = X[idx], Y[idx]
            for k in range(0, len(Y), args.batch):
                xb = torch.from_numpy(X[k:k + args.batch]).to(dev)
                yb = torch.from_numpy(Y[k:k + args.batch]).to(dev)
                opt.zero_grad()
                loss = lossf(net(xb), yb)
                loss.backward()
                opt.step()
                step += 1
            if step % 400 < len(Y) // args.batch + 1:
                with torch.no_grad():
                    vl = lossf(net(Xv), Yv).item()
                print(f"  epoch {epoch} step {step}: val huber {vl:.4f} "
                      f"({time.time() - t0:.0f}s)", flush=True)
                torch.save(net.state_dict(), args.out)
    torch.save(net.state_dict(), args.out)
    with torch.no_grad():
        vl = lossf(net(Xv), Yv).item()
    print(f"final val huber {vl:.4f} -> {args.out}", flush=True)


class WidowChooser:
    """Enumerates (discard, trump) options and argmaxes the net.
    longest_only enforces Riley's hard rule: trump must be one of the
    longest suits in the 13 (ties allowed) — v1 already chose that way
    99.2% of the time on its own; pinning it spends the net's whole
    capacity on the go-down."""

    def __init__(self, path: str = MODEL_PATH, longest_only: bool = False):
        self.net = WidowNet()
        self.net.load_state_dict(torch.load(path, map_location="cpu",
                                            weights_only=True))
        self.net.eval()
        self.longest_only = longest_only

    @torch.no_grad()
    def choose(self, hand13, bid):
        hand13 = sorted(hand13)
        trumps = list(SUITS)
        if self.longest_only:
            import collections
            lens = collections.Counter(suit_of(c) for c in hand13)
            mx = max(lens.values())
            trumps = [s for s in SUITS if lens.get(s, 0) == mx]
        cands = []
        for disc in itertools.combinations(hand13, 4):
            for t in trumps:
                if any(suit_of(c) == t for c in hand13 if c not in disc):
                    cands.append((list(disc), t))
        X = np.stack([featurize(hand13, bid, d, t) for d, t in cands])
        q = self.net(torch.from_numpy(X)).numpy()
        return cands[int(np.argmax(q))]


# ---------------------------------------------------------------------------
# The gate: fresh contracts, twin rollouts, paired made%/points
# ---------------------------------------------------------------------------

_G: dict = {}


def _gate_init(net_path, brain_path, longest_only=False):
    torch.set_num_threads(1)
    from .widowgym_data import rollout  # noqa: F401
    _G["net"] = load_qnet(net_path)
    _G["chooser"] = WidowChooser(brain_path, longest_only=longest_only)


def _gate_chunk(seeds):
    from .widowgym_data import harvest_snapshots_only as _h  # placeholder
    raise RuntimeError("unused")


def _gate_seed(seed):
    """One game's contracts: twin rollouts of chooser vs gen23 choice."""
    import torch as _t
    from rook.cards import team_of
    from rook.engine import WIDOW, HAND_DONE, GAME_OVER
    from .env import SelfPlayGame
    from .arena import model_choose
    from .duel import deck_stream
    from .encoder import D_TRUMP
    from .widowgym_data import rollout
    net = _G["net"]
    chooser = _G["chooser"]
    out = []
    with _t.no_grad():
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        while not env.done:
            s, dt, cands = env.decision()
            a = model_choose(net, "cpu", env, s, dt, cands)
            if dt == D_TRUMP and env.trump_intent is None and \
                    env.g.phase == WIDOW:
                g0 = env.g.clone()
                env.apply(a)
                picks = []
                while env.g.phase == WIDOW:
                    s2, dt2, cd = env.decision()
                    p = model_choose(net, "cpu", env, s2, dt2, cd)
                    picks.append(p)
                    env.apply(p)
                own_made, own_score = rollout(g0, s, picks, a, net)
                bd, bt = chooser.choose(g0.hands[s], g0.high_bid)
                br_made, br_score = rollout(g0, s, bd, bt, net)
                out.append((int(br_made), int(own_made),
                            int(br_score), int(own_score)))
                continue
            env.apply(a)
    return out


def gate(args):
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    seeds = list(range(args.seed, args.seed + args.games))
    rows = []
    t0 = time.time()
    with ctx.Pool(args.workers, initializer=_gate_init,
                  initargs=(args.net, args.brain,
                            getattr(args, "longest_only", False))) as pool:
        for n, out in enumerate(pool.imap_unordered(_gate_seed, seeds), 1):
            rows.extend(out)
            if n % 40 == 0 and rows:
                bm = statistics.mean(r[0] for r in rows)
                om = statistics.mean(r[1] for r in rows)
                print(f"  [{n}/{len(seeds)} games, {len(rows)} contracts] "
                      f"brain made {bm:.1%} vs gen23 {om:.1%} "
                      f"({(time.time() - t0) / n:.1f}s/game)", flush=True)
            if len(rows) >= args.contracts:
                pool.terminate()
                break
    rows = rows[:args.contracts]
    n = len(rows)
    bm = sum(r[0] for r in rows)
    om = sum(r[1] for r in rows)
    up = sum(1 for r in rows if r[0] and not r[1])
    down = sum(1 for r in rows if r[1] and not r[0])
    se = math.sqrt(up + down) / n
    dpts = statistics.mean(r[2] - r[3] for r in rows)
    print(f"\nWIDOWBRAIN GATE — {n} fresh contracts, twin rollouts, "
          f"no peeking:")
    print(f"  made: brain {bm / n:.1%} vs gen23 {om / n:.1%} "
          f"(paired delta {(bm - om) / n:+.2%} ± {1.96 * se:.2%})")
    print(f"  flips: up {up}, down {down}")
    print(f"  avg scoreboard delta: {dpts:+.1f} pts/contract")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    tp = sub.add_parser("train")
    tp.add_argument("--shards", default=SHARDS)
    tp.add_argument("--out", default=MODEL_PATH)
    tp.add_argument("--epochs", type=int, default=2)
    tp.add_argument("--batch", type=int, default=8192)
    tp.add_argument("--lr", type=float, default=1e-3)
    gp = sub.add_parser("gate")
    gp.add_argument("--contracts", type=int, default=3000)
    gp.add_argument("--games", type=int, default=2000)
    gp.add_argument("--workers", type=int, default=8)
    gp.add_argument("--seed", type=int, default=4_000_000_000)
    gp.add_argument("--net", default="models/gen23-cand1.pt")
    gp.add_argument("--brain", default=MODEL_PATH)
    gp.add_argument("--longest-only", action="store_true")
    args = ap.parse_args()
    if args.cmd == "train":
        train(args)
    else:
        gate(args)


if __name__ == "__main__":
    main()
