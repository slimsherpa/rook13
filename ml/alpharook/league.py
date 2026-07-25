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
            # sugar for GOOD behavior: an auction only counts if you
            # won it AND delivered — raw auction-winning sugar bred a
            # feral overbidding meta in season 1 (league-bid, ruler 18%)
            bid_t = 1.0 if (team_of(bid_winner) == team
                            and hs[team] > 0) else 0.0
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


def _rebuild(sd):
    """Every fighter carries its own era: infer architecture from the
    weights (v1 gen7-10 = 479-dim states, v2 gen13+ = 508; the encoder
    dispatches per net, so mixed-generation matches just work)."""
    from .model import QNet
    lin = sorted((k for k in sd if k.startswith("net.")
                  and k.endswith(".weight")),
                 key=lambda k: int(k.split(".")[1]))
    net = QNet(hidden=tuple(int(sd[k].shape[0]) for k in lin[:-1]),
               state_dim=sd[lin[0]].shape[1] - 50,
               belief=any(k.startswith("belief_head") for k in sd))
    net.load_state_dict(sd)
    net.eval()
    return net


def _wmatch(args):
    sd_a, sd_b, seeds, eps, sugar, replays = args
    na = _rebuild(sd_a)
    nb = _rebuild(sd_b)
    rows_a, rows_b = [], []
    wins_a = 0
    losses = []  # (winner_side, pair_seed, flip)
    for ps in seeds:
        for flip in (False, True):
            w = play_match_game(na, nb, ps, flip, eps, rows_a, rows_b, sugar)
            wins_a += 1 if w == 0 else 0
            losses.append((w, ps, flip))
    # Riley's replay-the-loss: each side re-plays one game it lost, up to
    # `replays` retries with widened exploration — a chance to LEARN the
    # deal rather than be punished for it; every retry row carries a real
    # outcome, so calibration stays honest
    if replays:
        rng0 = random.Random(seeds[0] ^ 0x5EED)
        for side in (0, 1):
            lost = [(ps, fl) for w, ps, fl in losses if w != side]
            if not lost:
                continue
            ps, fl = rng0.choice(lost)
            for _ in range(replays):
                w = play_match_game(na, nb, ps, fl, 0.15,
                                    rows_a, rows_b, sugar)
                if w == side:
                    break
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
    ap.add_argument("--anchor", default="models/gen13.pt",
                    help="frozen non-training league member (gravity; NONE to disable)")
    ap.add_argument("--select-every", type=int, default=150,
                    help="rounds between selection events: all fighters take the ruler exam, bottom two are replaced by clones of the two best banked")
    ap.add_argument("--select-pairs", type=int, default=30)
    ap.add_argument("--replay-losses", type=int, default=2,
                    help="retries of a lost deal per side per match "
                         "chunk (0 = off); rows keep real outcomes")
    ap.add_argument("--freeze-trunk", action="store_true",
                    help="train ONLY the v3 dealer columns (the gen13 "
                         "two-stage law: zero-init senses can be added "
                         "safely; converged trunks churn under DMC — "
                         "12 experiments deep, the only safe learning)")
    ap.add_argument("--max-hours", type=float, default=12.0,
                    help="clean exit after this long (Riley's 2x-daily "
                         "review cadence); resume with --resume")
    ap.add_argument("--resume", action="store_true")
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
    trainable = [True] * len(nets)
    if args.anchor and args.anchor != 'NONE':
        names.append('anchor')
        nets.append(load_qnet(args.anchor))
        trainable.append(False)
    banked = {}  # name -> (ruler_wr, state_dict) best ever
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

    start_round = 0
    state_path = run_dir / "league_state.pt"
    if args.resume and state_path.exists():
        st = torch.load(state_path, map_location="cpu", weights_only=False)
        if "names" in st and len(st["names"]) == len(names):
            names = list(st["names"])
        for i, nm in enumerate(names):
            if nm in st["nets"]:
                nets[i] = _rebuild(st["nets"][nm])
                if trainable[i]:
                    opts[i] = torch.optim.Adam(nets[i].parameters(),
                                               lr=args.lr)
                    if nm in st["opts"]:
                        try:
                            opts[i].load_state_dict(st["opts"][nm])
                        except Exception:
                            pass
        elo.update(st["elo"])
        banked.update(st["banked"])
        start_round = st["round"] + 1
        print(f"resumed {args.run} at round {start_round}")

    t_start = time.time()
    print(f"LEAGUE {args.run}: {len(nets)} fighters {names}, sugar {sugar}")
    for rd in range(start_round, args.rounds):
        if (time.time() - t_start) > args.max_hours * 3600:
            print(f"max-hours reached at round {rd} — clean exit")
            break
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
                jobs.append((sd_i, sd_j, seeds, args.eps, sugar,
                             args.replay_losses))
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
                if not packs or not trainable[idx]:
                    continue
                S = torch.from_numpy(np.concatenate([p2[0] for p2 in packs]))
                A = torch.from_numpy(np.concatenate([p2[1] for p2 in packs]))
                Y = torch.from_numpy(np.concatenate([p2[2] for p2 in packs]))
                net, opt = nets[idx], opts[idx]
                from .encoder import STATE_DIM_V2 as _V2, STATE_DIM_V3 as _V3
                v3 = (net.net[0].in_features - 50) == _V3
                if args.freeze_trunk and not v3:
                    continue  # nothing new to learn safely (gen10, etc.)
                net.train()
                for _ in range(args.epochs):
                    p = torch.randperm(len(Y))
                    for b in range(0, len(Y), args.batch_size):
                        bi = p[b:b + args.batch_size]
                        loss = torch.nn.functional.mse_loss(
                            net(S[bi], A[bi]), Y[bi])
                        opt.zero_grad(); loss.backward()
                        if args.freeze_trunk:
                            for name2, prm in net.named_parameters():
                                if prm.grad is None:
                                    continue
                                if name2 == "net.0.weight":
                                    keep = prm.grad[:, _V2:_V3].clone()
                                    prm.grad.zero_()
                                    prm.grad[:, _V2:_V3] = keep
                                else:
                                    prm.grad.zero_()
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
            leader = max((i for i in range(len(nets)) if trainable[i]),
                         key=lambda i: elo[names[i]])
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
            torch.save({"nets": {nm: nt.state_dict()
                                 for nm, nt in zip(names, nets)},
                        "opts": {nm: op.state_dict()
                                 for nm, op, tr in zip(names, opts, trainable)
                                 if tr},
                        "elo": elo, "banked": banked, "round": rd,
                        "names": names},
                       state_path)

        if (args.select_every and rd > 0 and rd % args.select_every == 0):
            # NATURAL SELECTION: everyone takes the external exam; the two
            # worst are replaced by clones of the two best banked fighters
            # (fresh optimizers). The anchor neither sits nor dies.
            from .duel import Side, duel as run_duel
            fitness = {}
            for idx in range(len(nets)):
                if not trainable[idx]:
                    continue
                wr = run_duel(Side(names[idx], "none", net=nets[idx]),
                              Side(args.ruler, "none"), args.select_pairs,
                              seed=rd * 31337 + idx, verbose=False)
                fitness[idx] = wr
                prev = banked.get(names[idx], (-1.0, None))[0]
                if wr > prev:
                    banked[names[idx]] = (
                        wr, {k2: v.clone() for k2, v in
                             nets[idx].state_dict().items()})
            ranked = sorted(fitness, key=lambda i: fitness[i])
            from .encoder import STATE_DIM_V3 as _V3s

            def _learns(sd):
                return (sd["net.0.weight"].shape[1] - 50) == _V3s

            pool_items = [(nm, v) for nm, v in banked.items()
                          if v[1] is not None
                          and (not args.freeze_trunk or _learns(v[1]))]
            best_pool = sorted(pool_items, key=lambda kv: -kv[1][0])[:2]
            swaps = []
            for slot, (src_name, (src_wr, src_sd)) in zip(ranked[:2],
                                                          best_pool):
                if fitness[slot] >= src_wr:
                    continue
                # rebuild the slot at the SOURCE's architecture — loading
                # v1 weights into a v3 shell crashed season 5 at rd 150
                nets[slot] = _rebuild({k2: v.clone()
                                       for k2, v in src_sd.items()})
                opts[slot] = torch.optim.Adam(nets[slot].parameters(),
                                              lr=args.lr)
                # LINEAGE NAMING (Riley, 2026-07-24): the reborn slot takes
                # its parent's name + birth round — "v3-gen13.c450" — so
                # the dashboard shows genesis, not a dead fighter's jersey.
                old_name = names[slot]
                new_name = f"{src_name}.c{rd}"
                names[slot] = new_name
                elo.pop(old_name, None)
                elo[new_name] = float(np.mean(list(elo.values()))) \
                    if elo else 1000.0
                banked[new_name] = (src_wr,
                                    {k2: v.clone() for k2, v in
                                     src_sd.items()})
                swaps.append(f"{old_name}=>{new_name}@{src_wr:.0%}")
            rec["selection"] = {"fitness": {names[i]: round(w, 3)
                                            for i, w in fitness.items()},
                                "swaps": swaps}
            print(f"  SELECTION: " + "  ".join(
                f"{names[i]}={fitness[i]:.0%}" for i in ranked)
                + ("  | swaps: " + ", ".join(swaps) if swaps else
                   "  | no swaps"), flush=True)
        log(rec)
    pool.close()


if __name__ == "__main__":
    main()
