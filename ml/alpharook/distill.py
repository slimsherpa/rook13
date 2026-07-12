"""gen12: close the AlphaZero loop — distill search back into reflex weights.

Phase 1 (--generate): all four seats play gen11 (gen10 x PIMC search) in
self-play. Every SEARCHED decision emits a regression row per candidate:
the search's blended score is a strictly better-informed estimate of that
(state, action) than the net's own Q, because it folded in K worlds of
actual look-ahead. Reflex (unsearched) decisions emit low-weight ANCHOR
rows carrying gen10's own Q, so the student keeps its bidding/go-down/
early-play brain while the trunk absorbs the calculation.

Phase 2 (--train): stream the shards, weighted-MSE fine-tune from gen10,
duel vs gen10 after each epoch, save distilled.pt (+ best_duel-style
banking). TensorBoard lands in runs/<run>/tb like every other trainer.

    python -m alpharook.distill --generate --run gen12 --games 5000 \
        --workers 7 --max-hours 3.2
    python -m alpharook.distill --train --run gen12 --epochs 3
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from .encoder import encode_action, D_PLAY
from .env import SelfPlayGame
from .model import QNet

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"
ANCHOR_WEIGHT = 0.25


def _load_net(ckpt: str) -> QNet:
    net = QNet()
    ck = torch.load(ckpt, map_location="cpu", weights_only=True)
    net.load_state_dict(ck["model"] if "model" in ck else ck)
    net.eval()
    return net


# --- phase 1: generation ----------------------------------------------------

def _flush(out_dir: Path, worker: int, shard: int, S, A, y, w, di) -> None:
    np.savez_compressed(
        out_dir / f"shard_w{worker}_{shard:03d}.npz",
        S=np.stack(S).astype(np.float16),
        A=np.stack(A).astype(np.float16),
        y=np.array(y, dtype=np.float16),
        w=np.array(w, dtype=np.float16),
        di=np.array(di, dtype=np.int32))


def _gen_worker(job) -> dict:
    (worker, out_dir, ckpt, games, worlds, prior, min_trick,
     seed, deadline) = job
    torch.set_num_threads(1)
    from .search import SearchAgent  # after thread cap
    out_dir = Path(out_dir)
    net = _load_net(ckpt)
    agent = SearchAgent(net, worlds=worlds,
                        search_dtypes=frozenset({D_PLAY}),
                        prior_weight=prior, min_trick=min_trick,
                        seed=seed)
    S, A, y, w, di = [], [], [], [], []
    shard = 0
    stats = {"games": 0, "hands": 0, "search_rows": 0, "anchor_rows": 0}

    def record(tap, weight):
        state, dtype, cands, scores = tap
        di_val = len(S)
        S.append(state)
        for a, sc in zip(cands, scores):
            A.append(encode_action(dtype, a))
            y.append(sc)
            w.append(weight)
            di.append(di_val)

    for gi in range(games):
        if time.time() > deadline:
            break
        env = SelfPlayGame(seed=seed * 1_000_003 + gi * 7919)
        while not env.done:
            seat, dtype, cands = env.decision()
            action = agent.choose(env, seat, dtype, cands)
            if agent.last_search is not None:
                record(agent.last_search, 1.0)
                stats["search_rows"] += len(agent.last_search[2])
            elif agent.last_reflex is not None:
                record(agent.last_reflex, ANCHOR_WEIGHT)
                stats["anchor_rows"] += len(agent.last_reflex[2])
            env.apply(action)
        stats["games"] += 1
        stats["hands"] += len(env.g.hand_history)
        if len(A) >= 60_000:
            _flush(out_dir, worker, shard, S, A, y, w, di)
            shard += 1
            S, A, y, w, di = [], [], [], [], []
    if A:
        _flush(out_dir, worker, shard, S, A, y, w, di)
    return stats


def generate(args) -> None:
    run_dir = RUNS_DIR / args.run
    data_dir = run_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + args.max_hours * 3600
    per = (args.games + args.workers - 1) // args.workers
    jobs = [(i, str(data_dir), args.ckpt, per, args.worlds, args.prior,
             args.min_trick, args.seed + i * 104729, deadline)
            for i in range(args.workers)]
    t0 = time.time()
    import multiprocessing as mp
    with mp.get_context("spawn").Pool(args.workers) as pool:
        results = pool.map(_gen_worker, jobs)
    total = {k: sum(r[k] for r in results) for k in results[0]}
    total["sec"] = round(time.time() - t0, 1)
    total["config"] = {"ckpt": args.ckpt, "worlds": args.worlds,
                       "prior": args.prior, "min_trick": args.min_trick,
                       "anchor_weight": ANCHOR_WEIGHT}
    (run_dir / "gen_stats.json").write_text(json.dumps(total, indent=2))
    print(f"generated: {total['games']} games, {total['hands']} hands, "
          f"{total['search_rows']} search rows + {total['anchor_rows']} "
          f"anchor rows in {total['sec'] / 3600:.2f}h")


# --- phase 2: streaming weighted-MSE fine-tune ------------------------------

def train(args) -> None:
    run_dir = RUNS_DIR / args.run
    shards = sorted((run_dir / "data").glob("shard_*.npz"))
    assert shards, f"no shards under {run_dir / 'data'}"
    net = _load_net(args.init)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    rng = np.random.default_rng(0)

    tb = None
    try:
        from torch.utils.tensorboard import SummaryWriter
        tb = SummaryWriter(log_dir=str(run_dir / "tb"))
    except ImportError:
        pass

    def duel_vs_teacher(tag: str, step: int) -> float:
        from .duel import Side, duel as run_duel
        net.eval()
        wr = run_duel(Side("student", "none", net=net),
                      Side(args.ckpt, "none"),
                      args.duel_pairs, seed=step * 7919 + 17, verbose=False)
        print(f"  [{tag}] duel vs {args.ckpt}: {wr:.1%}", flush=True)
        if tb:
            tb.add_scalar("distill/duel_vs_teacher", wr, step)
        return wr

    step = 0
    best = -1.0
    for epoch in range(args.epochs):
        order = rng.permutation(len(shards))
        ep_losses = []
        for si in order:
            z = np.load(shards[si])
            S_dec = z["S"].astype(np.float32)
            A = z["A"].astype(np.float32)
            y = z["y"].astype(np.float32)
            w = z["w"].astype(np.float32)
            di = z["di"]
            n = len(y)
            perm = rng.permutation(n)
            net.train()
            for i in range(0, n, args.batch_size):
                idx = perm[i:i + args.batch_size]
                Sb = torch.from_numpy(S_dec[di[idx]])
                Ab = torch.from_numpy(A[idx])
                yb = torch.from_numpy(y[idx])
                wb = torch.from_numpy(w[idx])
                pred = net(Sb, Ab)
                loss = (wb * (pred - yb) ** 2).sum() / wb.sum()
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                opt.step()
                ep_losses.append(loss.item())
                step += 1
                if tb and step % 50 == 0:
                    tb.add_scalar("distill/loss", loss.item(), step)
        print(f"epoch {epoch}: loss {np.mean(ep_losses):.5f} "
              f"({step} steps)", flush=True)
        torch.save({"model": net.state_dict(), "epoch": epoch},
                   run_dir / "distilled.pt")
        wr = duel_vs_teacher(f"epoch {epoch}", step)
        if wr > best:
            best = wr
            torch.save({"model": net.state_dict(), "epoch": epoch,
                        "duel_win_rate": wr}, run_dir / "distilled_best.pt")
    if tb:
        tb.close()
    print(f"distilled.pt saved; best epoch duel {best:.1%}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="gen12")
    ap.add_argument("--ckpt", default="models/gen10.pt",
                    help="teacher: the searched net (and duel opponent)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--generate", action="store_true")
    mode.add_argument("--train", action="store_true")
    # generation
    ap.add_argument("--games", type=int, default=5000)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--worlds", type=int, default=24)
    ap.add_argument("--prior", type=float, default=2.0)
    ap.add_argument("--min-trick", type=int, default=3)
    ap.add_argument("--max-hours", type=float, default=3.2)
    ap.add_argument("--seed", type=int, default=0)
    # training
    ap.add_argument("--init", default="models/gen10.pt")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--duel-pairs", type=int, default=25)
    args = ap.parse_args()
    if args.generate:
        generate(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
