"""Train the mimic student: action-space behavior cloning of the champion
stack. Cross-entropy over legal candidates — no value regression anywhere
(four value-space distillations churned; classification on near-
deterministic labels is the channel with the spotless record).

Quiz metrics (held-out GAMES, never rows):
  match_all      top-1 teacher-match on every decision
  match_srch     on searched decisions
  match_ovr      on override rows — bare gen13 scores 0% here BY
                 CONSTRUCTION, so this is pure absorbed search-skill
Banking: best.pt by match_ovr (a stable supervised metric — the banking
mirage lived in tiny duels; quizzes don't wobble). Duels confirm later.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from .encoder import STATE_DIM_V4
from .mimic_data import MimicStream, build_val, pack_batch
from .model import QNet

RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"


def masked_logits(net, S, A, mask):
    B, C, AD = A.shape
    S_rep = S.unsqueeze(1).expand(-1, C, -1).reshape(B * C, -1)
    q = net(S_rep, A.reshape(B * C, AD)).reshape(B, C)
    return q.masked_fill(~mask, -1e9)


@torch.no_grad()
def evaluate(net, val, batch: int = 2048):
    from .encoder import D_BID, D_DISCARD, D_TRUMP, D_PLAY
    S, A, mask, tgt, _w, kind, dts = val
    net.eval()
    hits = torch.zeros(3)
    counts = torch.zeros(3)
    dt_hits = {d: 0 for d in (D_BID, D_DISCARD, D_TRUMP, D_PLAY)}
    dt_counts = {d: 0 for d in (D_BID, D_DISCARD, D_TRUMP, D_PLAY)}
    loss_sum, n = 0.0, 0
    for i in range(0, len(S), batch):
        sl = slice(i, i + batch)
        logits = masked_logits(net, S[sl], A[sl], mask[sl])
        loss_sum += F.cross_entropy(logits, tgt[sl],
                                    reduction="sum").item()
        n += len(logits)
        pred = logits.argmax(1)
        for k in (0, 1, 2):
            m = kind[sl] == k
            counts[k] += m.sum()
            hits[k] += (pred[m] == tgt[sl][m]).sum()
        for d in dt_hits:
            m = dts[sl] == d
            dt_counts[d] += int(m.sum())
            dt_hits[d] += int((pred[m] == tgt[sl][m]).sum())
    net.train()
    match = {f"match_{nm}": round((hits[k] / counts[k]).item(), 4)
             for k, nm in ((0, "reflex"), (1, "srch_agree"), (2, "ovr"))
             if counts[k] > 0}
    dt_names = {D_BID: "bid", D_DISCARD: "discard", D_TRUMP: "trump",
                D_PLAY: "play"}
    match.update({f"match_{dt_names[d]}": round(dt_hits[d] / dt_counts[d], 4)
                  for d in dt_hits if dt_counts[d]})
    all_hit = hits.sum() / counts.sum()
    return dict(val_loss=round(loss_sum / n, 4),
                match_all=round(all_hit.item(), 4), **match,
                val_rows=int(counts.sum().item()),
                val_ovr_rows=int(counts[2].item()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--shards", required=True,
                    help="glob of raw gen_mimic JSONL shards")
    ap.add_argument("--hidden", default="1024,1024,512")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch-rows", type=int, default=512)
    ap.add_argument("--steps", type=int, default=1000000)
    ap.add_argument("--eval-every", type=int, default=2000)
    ap.add_argument("--reflex-keep", type=float, default=0.25)
    ap.add_argument("--ovr-weight", type=float, default=10.0)
    ap.add_argument("--val-games", type=int, default=400)
    ap.add_argument("--max-shards", type=int, default=0,
                    help="learning-curve knob: cap train shards (0 = all)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--init-from", default=None)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    paths = sorted(Path().glob(args.shards))
    assert paths, f"no shards match {args.shards}"
    train_paths = paths[:args.max_shards] if args.max_shards else paths

    print(f"[{args.run}] building validation set from {len(paths)} shards…",
          flush=True)
    val, val_games = build_val(paths, args.val_games)
    print(f"[{args.run}] val: {val_games} games, {len(val[0])} rows "
          f"({int((val[5] == 2).sum())} override)", flush=True)

    hidden = tuple(int(h) for h in args.hidden.split(","))
    net = QNet(hidden=hidden, state_dim=STATE_DIM_V4)
    if args.init_from:
        net.load_state_dict(torch.load(args.init_from,
                                       map_location="cpu")["model"])
    n_params = sum(p.numel() for p in net.parameters())
    print(f"[{args.run}] student {hidden} = {n_params:,} params, "
          f"state_dim {STATE_DIM_V4}, training on {len(train_paths)} shards",
          flush=True)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)

    stream = MimicStream(train_paths, reflex_keep=args.reflex_keep,
                         ovr_weight=args.ovr_weight, seed=args.seed)
    loader = torch.utils.data.DataLoader(
        stream, batch_size=args.batch_rows, num_workers=args.workers,
        collate_fn=pack_batch, prefetch_factor=4,
        persistent_workers=args.workers > 0)

    best_ovr, t0, seen = -1.0, time.time(), 0
    log = open(run_dir / "log.jsonl", "a")
    for step, (S, A, mask, tgt, wgt, _kind, _dts) in enumerate(loader):
        if step >= args.steps:
            break
        logits = masked_logits(net, S, A, mask)
        loss = (F.cross_entropy(logits, tgt, reduction="none")
                * wgt).sum() / wgt.sum()
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
        opt.step()
        seen += len(S)

        if step % args.eval_every == 0:
            m = evaluate(net, val)
            m.update(step=step, rows_seen=seen,
                     rows_per_sec=round(seen / (time.time() - t0), 1),
                     train_loss=round(loss.item(), 4),
                     ts=time.time())
            log.write(json.dumps(m) + "\n")
            log.flush()
            print(f"[{args.run} step {step}] loss {m['train_loss']} "
                  f"val {m['val_loss']} | match all {m['match_all']:.1%} "
                  f"ovr {m.get('match_ovr', 0):.1%} "
                  f"bid {m.get('match_bid', 0):.1%} "
                  f"play {m.get('match_play', 0):.1%} | "
                  f"{m['rows_per_sec']:.0f} rows/s", flush=True)
            torch.save({"model": net.state_dict(), "step": step,
                        "metrics": m}, run_dir / "latest.pt")
            if m.get("match_ovr", 0) > best_ovr:
                best_ovr = m["match_ovr"]
                torch.save({"model": net.state_dict(), "step": step,
                            "metrics": m}, run_dir / "best.pt")


if __name__ == "__main__":
    main()
