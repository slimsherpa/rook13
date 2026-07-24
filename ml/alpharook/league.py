"""THE LEAGUE (Riley's ultimate gym, 2026-07-24): full-game population play.

A population of complete agents — the champion, the seat specialists, the
elders — fights round after round of REAL full games (-250..500, real
auctions, real tricks, duplicate deals with seats swapped). No frozen
champion at the table: everyone trains, everyone evolves, matchmaking by
Elo. gen13 appears only as the RULER — a fixed external exam, never a
sparring partner.

Rewards are Riley's sugar, a shaped blend per decision of the team that
made it:

    target = w_bid  * (my team won this hand's auction)
           + w_pts  * (points we captured this hand / 120)
           + w_hand * clip(hand score swing / 200)      # the proven term
           + w_game * (0.7 win/loss + 0.3 diff/500)     # the proven term

Each league (one per box) runs its own sugar recipe — four cultures, four
metas; champions exchange between boxes by rsync (the inter-city
tournament). Post-mortem replay of lost deals (the blunder-finder loop)
arrives in v1.1 — the hook is --replay-losses, default off.

    python -m alpharook.league --run league-balanced \
        --agents models/gen13.pt models/spec-taker.pt ... --workers 7
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from rook.cards import team_of
from rook.observation import observe
from .encoder import encode_state_for, encode_action, D_BID
from .env import SelfPlayGame
from .model import load_qnet
from .duel import deck_stream
from .selfplay import belief_target

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"


def pick(net, env, seat, dtype, cands, eps, rng) -> int:
    if len(cands) == 1:
        return 0
    if rng.random() < eps:
        return rng.randrange(len(cands))
    s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                         env.g, env.trump_intent)
    S = torch.from_numpy(np.stack([s] * len(cands)))
    A = torch.from_numpy(np.stack([encode_action(dtype, a) for a in cands]))
    with torch.no_grad():
        return int(net(S, A).argmax().item())


@torch.no_grad()
def play_match_game(net_a, net_b, pair_seed: int, flip: bool, eps: float,
                    rows_a: list, rows_b: list, sugar: dict):
    """One real full game; both sides collect shaped training rows."""
    rng = random.Random(pair_seed ^ (0xBEEF if flip else 0xFACE))
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_stream(pair_seed),
                       dealer=pair_seed % 4)
    team_of_a = 1 if flip else 0
    buf = {0: [], 1: []}          # per team: rows awaiting hand labels
    labeled = {0: [], 1: []}      # per team: rows awaiting the game label
    hands_seen = 0
    while not env.done:
        g = env.g
        if len(g.hand_history) > hands_seen:
            _label_hand(g, hands_seen, buf, labeled, sugar)
            hands_seen = len(g.hand_history)
        seat, dtype, cands = env.decision()
        team = team_of(seat)
        net = net_a if team == team_of_a else net_b
        j = pick(net, env, seat, dtype, cands, eps, rng)
        s = encode_state_for(net, observe(g, seat), env.picks, dtype, g,
                             env.trump_intent)
        bt, bm = belief_target(g, seat)
        buf[team].append((s, encode_action(dtype, cands[j]), bt, bm,
                          g.hand_number))
        env.apply(cands[j])
    g = env.g
    while hands_seen < len(g.hand_history):
        _label_hand(g, hands_seen, buf, labeled, sugar)
        hands_seen += 1
    for team in (0, 1):
        wl = 1.0 if g.winner == team else -1.0
        diff = max(-1.0, min(1.0, (g.scores[team] - g.scores[1 - team]) / 500.0))
        game_t = 0.7 * wl + 0.3 * diff
        out = rows_a if team == team_of_a else rows_b
        for s, a, bt, bm, partial in labeled[team]:
            out.append((s, a, partial + sugar["game"] * game_t, bt, bm))
    return 0 if g.winner == team_of_a else 1


def _label_hand(g, h_idx, buf, labeled, sugar):
    h = g.hand_history[h_idx]
    hand_no, bid_winner, _bid, _tr, hs0, hs1, _set = h[:7]
    hs = (hs0, hs1)
    for team in (0, 1):
        keep = []
        for s, a, bt, bm, hn in buf[team]:
            if hn != hand_no:
                keep.append((s, a, bt, bm, hn))
                continue
            bid_t = 1.0 if team_of(bid_winner) == team else 0.0
            pts_t = max(0.0, hs[team]) / 120.0
            hand_t = max(-1.0, min(1.0, (hs[team] - hs[1 - team]) / 200.0))
            partial = (sugar["bid"] * bid_t + sugar["pts"] * pts_t
                       + sugar["hand"] * hand_t)
            labeled[team].append((s, a, bt, bm, partial))
        buf[team] = keep


def _elo_update(ra, rb, score_a, k=24.0):
    ea = 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))
    return ra + k * (score_a - ea), rb - k * (score_a - ea)


# --- workers: one match (a run of duplicate deal-pairs) per request -------

_W: dict = {}


def _winit():
    torch.set_num_threads(1)


def _wmatch(args):
    sd_a, sd_b, seeds, eps, sugar, arch = args
    from .model import QNet
    na = QNet(hidden=arch[0], state_dim=arch[1]); na.load_state_dict(sd_a); na.eval()
    nb = QNet(hidden=arch[0], state_dim=arch[1]); nb.load_state_dict(sd_b); nb.eval()
    rows_a, rows_b = [], []
    wins_a = 0
    for ps in seeds:
        for flip in (False, True):
            w = play_match_game(na, nb, ps, flip, eps, rows_a, rows_b, sugar)
            wins_a += 1 if w == 0 else 0
    def pack(rows):
        if not rows:
            return None
        return (np.stack([r[0] for r in rows]),
                np.stack([r[1] for r in rows]),
                np.array([r[2] for r in rows], dtype=np.float32))
    return pack(rows_a), pack(rows_b), wins_a, 2 * len(seeds)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="league")
    ap.add_argument("--agents", nargs="+", required=True,
                    help="checkpoint per fighter (name = file stem)")
    ap.add_argument("--sugar-bid", type=float, default=0.10)
    ap.add_argument("--sugar-pts", type=float, default=0.15)
    ap.add_argument("--sugar-hand", type=float, default=0.25)
    ap.add_argument("--sugar-game", type=float, default=0.50)
    ap.add_argument("--match-pairs", type=int, default=24,
                    help="duplicate deal-pairs per match chunk per worker")
    ap.add_argument("--rounds", type=int, default=100000)
    ap.add_argument("--eps", type=float, default=0.05)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--ruler", default="models/gen13.pt")
    ap.add_argument("--ruler-every", type=int, default=40,
                    help="rounds between external exams of the Elo leader")
    ap.add_argument("--ruler-pairs", type=int, default=50)
    ap.add_argument("--replay-losses", type=int, default=0,
                    help="v1.1 hook: post-mortem replays per round (off)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    sugar = {"bid": args.sugar_bid, "pts": args.sugar_pts,
             "hand": args.sugar_hand, "game": args.sugar_game}

    names = [Path(p).stem for p in args.agents]
    nets = [load_qnet(p) for p in args.agents]
    arch = (tuple(m.out_features for m in nets[0].net
                  if hasattr(m, "out_features"))[:-1],
            nets[0].net[0].in_features - 50)
    opts = [torch.optim.Adam(n.parameters(), lr=args.lr) for n in nets]
    elo = {n: 1000.0 for n in names}
    ruler = load_qnet(args.ruler)

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    pool = ctx.Pool(args.workers, initializer=_winit)

    def log(rec):
        rec["ts"] = time.time()
        with open(run_dir / "log.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")

    print(f"LEAGUE {args.run}: {len(nets)} fighters {names}, sugar {sugar}")
    for rd in range(args.rounds):
        t0 = time.time()
        # matchmaking: shuffle into pairs, closest-Elo adjacent
        order = sorted(range(len(nets)),
                       key=lambda i: elo[names[i]] + rng.gauss(0, 60))
        pairs = []
        for k in range(0, len(order) - 1, 2):
            pairs.append((order[k], order[k + 1]))
        # split every match across the pool so all cores fight
        chunks = max(1, args.workers // max(1, len(pairs)))
        per = max(2, args.match_pairs // chunks)
        jobs, meta = [], []
        for pi, (i, j) in enumerate(pairs):
            sd_i = {k2: v.cpu() for k2, v in nets[i].state_dict().items()}
            sd_j = {k2: v.cpu() for k2, v in nets[j].state_dict().items()}
            for _ in range(chunks):
                seeds = [rng.randrange(1 << 30) for _ in range(per)]
                jobs.append((sd_i, sd_j, seeds, args.eps, sugar, arch))
                meta.append(pi)
        results = pool.map(_wmatch, jobs)
        agg = {pi: [[], [], 0, 0] for pi in range(len(pairs))}
        for pi, (pa, pb, wins_a, n) in zip(meta, results):
            if pa is not None:
                agg[pi][0].append(pa)
            if pb is not None:
                agg[pi][1].append(pb)
            agg[pi][2] += wins_a
            agg[pi][3] += n
        games = 0
        for pi, (i, j) in enumerate(pairs):
            packs_a, packs_b, wins_a, n = agg[pi]
            if n == 0:
                continue
            games += n
            elo[names[i]], elo[names[j]] = _elo_update(
                elo[names[i]], elo[names[j]], wins_a / n)
            for idx, packs in ((i, packs_a), (j, packs_b)):
                if not packs:
                    continue
                S = torch.from_numpy(np.concatenate([p2[0] for p2 in packs]))
                A = torch.from_numpy(np.concatenate([p2[1] for p2 in packs]))
                Y = torch.from_numpy(np.concatenate([p2[2] for p2 in packs]))
                net, opt = nets[idx], opts[idx]
                net.train()
                for _ in range(args.epochs):
                    p = torch.randperm(len(Y))
                    for b in range(0, len(Y), args.batch_size):
                        bi = p[b:b + args.batch_size]
                        loss = torch.nn.functional.mse_loss(
                            net(S[bi], A[bi]), Y[bi])
                        opt.zero_grad(); loss.backward()
                        torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                        opt.step()
                net.eval()
        board = sorted(elo.items(), key=lambda kv: -kv[1])
        rec = {"round": rd, "games": games,
               "elo": {k: round(v, 1) for k, v in elo.items()},
               "sec": round(time.time() - t0, 1)}
        print(f"[{args.run} rd {rd}] {games} games {rec['sec']}s | "
              + "  ".join(f"{k}:{v:.0f}" for k, v in board[:3]), flush=True)
        if rd % args.ruler_every == 0 or rd == args.rounds - 1:
            leader = max(range(len(nets)), key=lambda i: elo[names[i]])
            from .duel import Side, duel as run_duel
            wr = run_duel(Side("leader", "none", net=nets[leader]),
                          Side(args.ruler, "none"),
                          args.ruler_pairs, seed=rd * 7919, verbose=False)
            rec["ruler_leader"] = names[leader]
            rec["ruler_wr"] = round(wr, 3)
            print(f"  RULER: {names[leader]} vs gen13 = {wr:.1%}", flush=True)
            for nm, nt in zip(names, nets):
                torch.save({"model": nt.state_dict(), "round": rd,
                            "elo": elo[nm]}, run_dir / f"{nm}.pt")
        log(rec)
    pool.close()


if __name__ == "__main__":
    main()
