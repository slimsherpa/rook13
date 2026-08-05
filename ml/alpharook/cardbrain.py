"""CardBrain — the per-decision card-play specialist (gen24, 2026-08-01).

Trained on the cardplay gym's twin-decision corpus: real gen23 game
states where every legal card was rolled out in the frozen true world
and labeled with its team hand-score ADVANTAGE over gen23's actual
line. "Beat gen23's card, get rewarded" — the widow gym's loss
function, pointed at the biggest remaining surface.

Input is the full leak-tested encoder-v4 state (everything a human in
the chair sees: scorecard, dealer, auction transcript, trump, played
cards, points captured — house rule #1) plus the candidate-card action
encoding. Output: predicted advantage. At decision time it scores every
legal card in one batched forward and argmaxes; a confidence threshold
tau decides when it may OVERRIDE gen23 (near-tie needles are noise —
the gen23-quiz lesson — so the brain only speaks when it predicts a
loud gain).

    ~/torch-env/bin/python -m alpharook.cardbrain train
    ~/torch-env/bin/python -m alpharook.cardbrain quiz --decisions 2000

quiz = Gate A (test-the-test): fresh seeds; wherever the brain would
override gen23, BOTH cards are twin-rolled-out in the true world and
the realized delta is recorded. Answers "when it disagrees, is it
right?" with per-tau, per-trick slices, before any full-game gauntlet.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import statistics
import time

import numpy as np
import torch
import torch.nn as nn

from .encoder import (ACTION_DIM, D_PLAY, STATE_DIM_V4, encode_action,
                      encode_state_v4)

FEAT_DIM = STATE_DIM_V4 + ACTION_DIM        # 530 + 50
MODEL_PATH = "models/cardbrain-v0.pt"
SHARDS = "runs/gen24/cardgym/shards"
ADV_SCALE = 200.0                            # a full hand flip ~ +/-1


class CardNet(nn.Module):
    def __init__(self, dim: int = FEAT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, 512), nn.ReLU(),
            nn.Linear(512, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


class GraftNet(nn.Module):
    """v3: the advantage head grafted onto gen23's own FROZEN trunk (law
    4's move, sample-efficiency edition). The from-scratch CardNet could
    not fit even its own corpus at 136k states (33.7% agreement with the
    donor, 16.8% regret capture on held-out rows) — a 530-dim mid-game
    manifold is too big to learn from scratch on an MBP corpus. gen23's
    trunk already embeds that manifold from 60M mimic rows; we read its
    LAST hidden layer (the value-shaped representation) through a small
    trainable head. The champion's weights are never touched."""

    def __init__(self, qnet):
        super().__init__()
        self.qnet = qnet
        for p in self.qnet.parameters():
            p.requires_grad_(False)
        # trunk net = [Lin,ReLU]*3 + Lin ; last hidden = after index 5
        self.trunk_end = len(self.qnet.net) - 1
        h_last = self.qnet.net[self.trunk_end].in_features
        self.head = nn.Sequential(
            nn.Linear(h_last, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, 1))

    def features(self, x):
        with torch.no_grad():
            for m in self.qnet.net[:self.trunk_end]:
                x = m(x)
        return x

    def forward(self, x):
        return self.head(self.features(x)).squeeze(-1)


_ACT_CACHE = {c: encode_action(D_PLAY, c) for c in range(40)}


def _shard_arrays(path: str):
    from .cardgym_data import unpack_state
    X, Y = [], []
    for line in open(path):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        s = unpack_state(r["x"], STATE_DIM_V4)
        for c in r["cands"]:
            X.append(np.concatenate([s, _ACT_CACHE[c["c"]]]))
            Y.append(np.clip(c["adv"] / ADV_SCALE, -2.0, 2.0))
    if not X:
        return None
    return np.stack(X).astype(np.float32), np.array(Y, dtype=np.float32)


def train(args):
    shards = sorted(glob.glob(os.path.join(args.shards, "*.jsonl")))
    if len(shards) < 5:
        raise SystemExit(f"only {len(shards)} shards in {args.shards}")
    val = shards[-3:]
    tr = shards[:-3]
    print(f"{len(tr)} train shards, {len(val)} val", flush=True)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    if args.graft:
        from .model import load_qnet
        net = GraftNet(load_qnet(args.graft)).to(dev)
        params = net.head.parameters()
    else:
        net = CardNet().to(dev)
        params = net.parameters()
    opt = torch.optim.Adam(params, lr=args.lr, weight_decay=1e-5)
    lossf = nn.HuberLoss(delta=0.5)
    vparts = [a for a in (_shard_arrays(p) for p in val) if a]
    Xv = torch.from_numpy(np.concatenate([v[0] for v in vparts])).to(dev)
    Yv = torch.from_numpy(np.concatenate([v[1] for v in vparts])).to(dev)
    # the val metric that matters: on rows with a loud label (|adv|>=10),
    # does the net rank the best candidate first? (argmax quiz, not loss)
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
                torch.save(net.head.state_dict() if args.graft
                           else net.state_dict(), args.out)
    torch.save(net.head.state_dict() if args.graft else net.state_dict(),
               args.out)
    with torch.no_grad():
        vl = lossf(net(Xv), Yv).item()
    print(f"final val huber {vl:.4f} -> {args.out}", flush=True)


class CardChooser:
    """Scores every legal card; returns (best_card, predicted_adv_pts)
    where predicted_adv is relative to the field (max minus the score of
    a reference card if given, else 0)."""

    def __init__(self, path: str = MODEL_PATH, graft: str = ""):
        if graft:
            from .model import load_qnet
            self.net = GraftNet(load_qnet(graft))
            self.net.head.load_state_dict(
                torch.load(path, map_location="cpu", weights_only=True))
        else:
            self.net = CardNet()
            self.net.load_state_dict(torch.load(path, map_location="cpu",
                                                weights_only=True))
        self.net.eval()

    @torch.no_grad()
    def score(self, g, seat, cands, picks=None, trump_intent=None):
        from rook.observation import observe
        s = encode_state_v4(observe(g, seat), picks or [], D_PLAY, g,
                            trump_intent)
        X = np.stack([np.concatenate([s, _ACT_CACHE[c]]) for c in cands])
        q = self.net(torch.from_numpy(X.astype(np.float32))).numpy()
        return {c: float(q[i]) * ADV_SCALE for i, c in enumerate(cands)}


# ---------------------------------------------------------------------------
# Gate A — the override quiz: fresh seeds, twin rollouts where brain differs
# ---------------------------------------------------------------------------

_G: dict = {}


def _quiz_init(net_path, brain_path, graft=""):
    torch.set_num_threads(1)
    from .model import load_qnet
    _G["net"] = load_qnet(net_path)
    _G["net"].eval()
    _G["chooser"] = CardChooser(brain_path, graft=graft)


def _quiz_seed(seed):
    """One game: at every multi-option play decision, if the brain's
    argmax differs from gen23's pick, twin-rollout both cards and record
    the realized delta. Returns list of dicts."""
    from rook.cards import team_of
    from .arena import model_choose
    from .cardgym_data import rollout_hand
    from .duel import deck_stream
    from .encoder import D_PLAY as _DP
    from .env import SelfPlayGame
    net, chooser = _G["net"], _G["chooser"]
    out = []
    with torch.no_grad():
        env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                           dealer=seed % 4)
        pend = []   # (g0, seat, hn, trick, chosen, brain_card, pred_gain)
        while not env.done:
            seat, dtype, cands = env.decision()
            pick = model_choose(net, "cpu", env, seat, dtype, cands)
            if dtype == _DP and len(cands) > 1:
                qs = chooser.score(env.g, seat, cands, env.picks,
                                   env.trump_intent)
                bc = max(qs, key=qs.get)
                if bc != pick:
                    pend.append(dict(
                        g0=env.g.clone(), seat=seat, hn=env.g.hand_number,
                        trick=len(env.g.completed_tricks),
                        declarer=int(seat == env.g.bid_winner),
                        decl_team=int(team_of(seat)
                                      == team_of(env.g.bid_winner)),
                        chosen=pick, brain=bc,
                        pred=qs[bc] - qs[pick]))
            env.apply(pick)
        hist = {h[0]: h for h in env.g.hand_history}
        for p in pend:
            if p["hn"] not in hist:
                continue
            base, bhn = rollout_hand(p["g0"], p["seat"], p["chosen"], net)
            alt, _ = rollout_hand(p["g0"], p["seat"], p["brain"], net)
            out.append(dict(seed=seed, trick=p["trick"],
                            declarer=p["declarer"],
                            decl_team=p["decl_team"],
                            pred=round(p["pred"], 1), delta=alt - base))
    return out


def quiz(args):
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    seeds = list(range(args.seed, args.seed + args.games))
    rows = []
    n_games = 0
    t0 = time.time()
    with ctx.Pool(args.workers, initializer=_quiz_init,
                  initargs=(args.net, args.brain, args.graft)) as pool:
        for out in pool.imap_unordered(_quiz_seed, seeds):
            rows.extend(out)
            n_games += 1
            if n_games % 20 == 0 and rows:
                d = statistics.mean(r["delta"] for r in rows)
                print(f"  [{n_games} games, {len(rows)} overrides] "
                      f"mean realized delta {d:+.1f} pts "
                      f"({(time.time() - t0) / n_games:.1f}s/game)",
                      flush=True)
            if len(rows) >= args.decisions:
                pool.terminate()
                break
    rows = rows[:args.decisions]
    if args.dump:
        with open(args.dump, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    n = len(rows)
    print(f"\nCARDBRAIN QUIZ — {n} overrides from {n_games} fresh games "
          f"(twin rollouts, true world):")
    for tau in (0, 0.5, 1, 2, 3, 5, 10):
        g = [r for r in rows if r["pred"] >= tau]
        if not g:
            continue
        d = [r["delta"] for r in g]
        win = sum(1 for x in d if x > 0)
        lose = sum(1 for x in d if x < 0)
        se = (statistics.pstdev(d) / (len(d) ** 0.5)) if len(d) > 1 else 0
        print(f"  tau>={tau:>2}: {len(g):>5} overrides | realized "
              f"{statistics.mean(d):+7.1f} ± {1.96 * se:.1f} pts/override | "
              f"good {win} bad {lose} wash {len(d) - win - lose}")
    print("\n  by trick (all overrides):")
    for t in sorted({r["trick"] for r in rows}):
        g = [r["delta"] for r in rows if r["trick"] == t]
        print(f"    trick {t}: {statistics.mean(g):+7.1f} pts over "
              f"{len(g):,}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    tp = sub.add_parser("train")
    tp.add_argument("--shards", default=SHARDS)
    tp.add_argument("--out", default=MODEL_PATH)
    tp.add_argument("--epochs", type=int, default=2)
    tp.add_argument("--batch", type=int, default=8192)
    tp.add_argument("--lr", type=float, default=1e-3)
    tp.add_argument("--graft", default="",
                    help="path to a QNet (e.g. models/gen23-cand1.pt): "
                         "freeze it, train only an advantage head on its "
                         "last hidden layer")
    qp = sub.add_parser("quiz")
    qp.add_argument("--decisions", type=int, default=2000)
    qp.add_argument("--games", type=int, default=4000)
    qp.add_argument("--workers", type=int, default=6)
    qp.add_argument("--seed", type=int, default=6_000_000_000)
    qp.add_argument("--net", default="models/gen23-cand1.pt")
    qp.add_argument("--brain", default=MODEL_PATH)
    qp.add_argument("--graft", default="")
    qp.add_argument("--dump", default="")
    args = ap.parse_args()
    if args.cmd == "train":
        train(args)
    else:
        quiz(args)


if __name__ == "__main__":
    main()
