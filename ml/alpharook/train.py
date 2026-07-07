"""Deep Monte Carlo trainer.

Alternates fresh self-play collection with SGD on the just-collected batch
(on-policy DMC, the DouZero recipe). Everything stays on local disk under
ml/runs/<name>/ — never Firebase.

Start a run:
    cd ml && ~/torch-env/bin/python -m alpharook.train --run gen1
Resume:
    ... --run gen1 --resume
Watch:
    tail -f runs/gen1/log.jsonl
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from .model import QNet
from .selfplay import VecSelfPlay
from .arena import arena

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"


def epsilon_at(it: int, start: float, end: float, decay_iters: int) -> float:
    if it >= decay_iters:
        return end
    return start + (end - start) * it / decay_iters


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="dev")
    ap.add_argument("--iters", type=int, default=1000)
    ap.add_argument("--envs", type=int, default=32)
    ap.add_argument("--samples-per-iter", type=int, default=16384)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--device", default="cpu", help="cpu | mps")
    ap.add_argument("--eval-every", type=int, default=20)
    ap.add_argument("--eval-games", type=int, default=40)
    ap.add_argument("--eps-start", type=float, default=0.20)
    ap.add_argument("--eps-end", type=float, default=0.02)
    ap.add_argument("--eps-decay-iters", type=int, default=200)
    ap.add_argument("--opponent-mix", type=float, default=0.5,
                    help="fraction of games where the opposing team is scripted bots")
    ap.add_argument("--opponent-style", default="basic")
    ap.add_argument("--bid-eps", type=float, default=0.15,
                    help="exploration floor for bid decisions (see selfplay.py)")
    ap.add_argument("--play-only", action="store_true",
                    help="curriculum stage 1: heuristic bids/discards/trump "
                         "everywhere, net learns card play only")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--init-from", default=None,
                    help="warm-start model weights (e.g. a behavior-cloned "
                         "runs/bc.pt); ignored when --resume finds a checkpoint")
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "log.jsonl"

    torch.manual_seed(args.seed)
    device = args.device
    net = QNet().to(device)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    start_iter = 0
    best_win = -1.0

    latest = run_dir / "latest.pt"
    if args.init_from and not (args.resume and latest.exists()):
        ck = torch.load(args.init_from, map_location="cpu", weights_only=True)
        net.load_state_dict(ck["model"] if "model" in ck else ck)
        print(f"warm-started from {args.init_from}")
    if args.resume and latest.exists():
        ck = torch.load(latest, map_location="cpu", weights_only=True)
        net.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        start_iter = ck["iter"] + 1
        best_win = ck.get("best_win", -1.0)
        print(f"resumed {args.run} at iter {start_iter}")

    vec = VecSelfPlay(args.envs, seed=args.seed * 7919 + start_iter,
                      opponent_mix=args.opponent_mix,
                      opponent_style=args.opponent_style,
                      bid_eps=args.bid_eps,
                      play_only=args.play_only)

    def log(rec: dict):
        rec["ts"] = time.time()
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")

    def save(it: int):
        torch.save({"model": net.state_dict(), "opt": opt.state_dict(),
                    "iter": it, "best_win": best_win}, latest)

    for it in range(start_iter, args.iters):
        t0 = time.time()
        eps = epsilon_at(it, args.eps_start, args.eps_end, args.eps_decay_iters)
        samples, stats = vec.play(net, device, eps, args.samples_per_iter)
        t_collect = time.time() - t0

        S = torch.from_numpy(np.stack([s for s, _, _ in samples])).to(device)
        A = torch.from_numpy(np.stack([a for _, a, _ in samples])).to(device)
        Y = torch.tensor([y for _, _, y in samples], dtype=torch.float32,
                         device=device)

        net.train()
        n = len(samples)
        losses = []
        for _ in range(args.epochs):
            perm = torch.randperm(n, device=device)
            for i in range(0, n, args.batch_size):
                idx = perm[i:i + args.batch_size]
                pred = net(S[idx], A[idx])
                loss = torch.nn.functional.mse_loss(pred, Y[idx])
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                opt.step()
                losses.append(loss.item())
        t_total = time.time() - t0

        mix_wr = stats["mix_wins"] / max(1, stats["mix_games"])
        rec = {
            "iter": it, "eps": round(eps, 4),
            "loss": round(float(np.mean(losses)), 5),
            "samples": n, "games": stats["games"],
            "hands_per_game": round(stats["hands"] / max(1, stats["games"]), 2),
            "set_rate": round(stats["sets"] / max(1, stats["bids"]), 3),
            "mix_games": stats["mix_games"],
            "mix_win_rate": round(mix_wr, 3),
            "sec_collect": round(t_collect, 1), "sec_total": round(t_total, 1),
            "games_total": vec.games_done,
        }
        print(f"[{args.run} it {it}] loss {rec['loss']:.4f} eps {eps:.2f} "
              f"{stats['games']} games ({rec['hands_per_game']} hands/game, "
              f"set {rec['set_rate']:.0%}, "
              f"mix {mix_wr:.0%}/{stats['mix_games']}) {t_total:.1f}s")
        log(rec)

        if (it + 1) % args.eval_every == 0 or it == args.iters - 1:
            for opp in ("random", "basic"):
                r = arena(net, device, opp, args.eval_games, seed=it * 31337,
                          play_only=args.play_only)
                r["iter"] = it
                r["kind"] = "eval"
                print(f"  eval vs {opp}: {r['win_rate']:.1%} "
                      f"(diff {r['avg_diff']:+.1f})")
                log(r)
                if opp == "basic" and r["win_rate"] > best_win:
                    best_win = r["win_rate"]
                    torch.save({"model": net.state_dict(), "iter": it,
                                "win_rate": best_win}, run_dir / "best.pt")
            save(it)

    save(args.iters - 1)
    print("done.")


if __name__ == "__main__":
    main()
