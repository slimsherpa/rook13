"""THE DARWIN GYM (Riley's design, 2026-07-25, gen22 era): evolution on
top of gen21, fed a contested-deal curriculum.

One gym = one city of 8 seats: 6 learners (all born as byte-copies of the
frozen champion) + 2 anchor seats played by the frozen champion itself
(Riley: "the frozen gen21 gets 2 players always" — the anti-pacifism
gravity of law 5/8). Every round, Elo-matched pairs fight REAL full games
at Riley's marathon rules (default −1000..2000: ~4x the hands, card luck
compressed) on decks drawn from the contested-deal library (contested.py)
— the curriculum that finally attacks law 3 at its root: fewer rows whose
outcome no decision could change.

Selection (Riley's clone-and-cull): on a wall-clock cadence every learner
sits the same salted exam — mirrored duplicate pairs vs the frozen champion
on HELD-OUT contested decks (never trained on). Best-ever checkpoints are
banked per lineage; the two worst fitters are replaced by clones of the two
best banked (fresh optimizers), taking the pedigree name parent.c<round>.
Exams also log Riley's skill-share metric per contest tier: of the hands
that were skill-decided (same side won them from both chairs), what share
did the learner take?

Cities differ by culture (tier weights, lr, eps, sugar) — and city 4 runs
--random-decks as the CONTROL: if curation is the active ingredient,
the curated cities must outpace it.

    python -m alpharook.evo --run evo-provo --city provo \
        --deck-lib runs/decks/lib.jsonl --tier-weights 0.15,0.35,0.50 \
        --workers 7 --resume
"""

from __future__ import annotations

import argparse
import json
import random
import time
import zlib
from pathlib import Path

import numpy as np
import torch

from rook.cards import team_of
from rook.observation import observe
from .encoder import encode_state_for, encode_action
from .env import SelfPlayGame
from .model import load_qnet
from .duel import deck_stream
from .league import pick, _rebuild, _elo_update
from .contested import load_library, CuratedDecks

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"
FOUNDERS = "ABCDEF"


# --- one full game, both sides collecting shaped rows ----------------------

@torch.no_grad()
def play_evo_game(net_a, net_b, pair_seed: int, flip: bool,
                  eps_a: float, eps_b: float, rows_a, rows_b,
                  sugar: dict, win: int, lose: int, deck_fn):
    """rows_a/rows_b may be None (frozen side — no training rows)."""
    rng = random.Random(pair_seed ^ (0xBEEF if flip else 0xFACE))
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_fn,
                       dealer=pair_seed % 4, win_score=win, lose_score=lose)
    team_of_a = 1 if flip else 0
    scale = (win - lose) / 2.0
    buf = {0: [], 1: []}
    labeled = {0: [], 1: []}
    hands_seen = 0
    while not env.done:
        g = env.g
        if len(g.hand_history) > hands_seen:
            _label_hands(g, hands_seen, buf, labeled, sugar)
            hands_seen = len(g.hand_history)
        seat, dtype, cands = env.decision()
        team = team_of(seat)
        a_side = team == team_of_a
        net = net_a if a_side else net_b
        rows = rows_a if a_side else rows_b
        eps = eps_a if a_side else eps_b
        j = pick(net, env, seat, dtype, cands, eps, rng)
        if rows is not None:
            s = encode_state_for(net, observe(g, seat), env.picks, dtype, g,
                                 env.trump_intent)
            buf[team].append((s, encode_action(dtype, cands[j]),
                              g.hand_number))
        env.apply(cands[j])
    g = env.g
    while hands_seen < len(g.hand_history):
        _label_hands(g, hands_seen, buf, labeled, sugar)
        hands_seen += 1
    for team in (0, 1):
        wl = 1.0 if g.winner == team else -1.0
        diff = max(-1.0, min(1.0,
                             (g.scores[team] - g.scores[1 - team]) / scale))
        game_t = 0.7 * wl + 0.3 * diff
        out = rows_a if team == team_of_a else rows_b
        if out is None:
            continue
        for s, a, partial in labeled[team]:
            out.append((s, a, partial + sugar["game"] * game_t))
    return (0 if g.winner == team_of_a else 1), len(g.hand_history)


def _label_hands(g, h_idx, buf, labeled, sugar):
    """Season-1's lesson baked in: auction sugar only for contracts DELIVERED."""
    h = g.hand_history[h_idx]
    hand_no, bid_winner = h[0], h[1]
    hs = (h[4], h[5])
    for team in (0, 1):
        keep = []
        for s, a, hn in buf[team]:
            if hn != hand_no:
                keep.append((s, a, hn))
                continue
            bid_t = 1.0 if (team_of(bid_winner) == team
                            and hs[team] > 0) else 0.0
            pts_t = max(0.0, hs[team]) / 120.0
            hand_t = max(-1.0, min(1.0, (hs[team] - hs[1 - team]) / 200.0))
            partial = (sugar["bid"] * bid_t + sugar["pts"] * pts_t
                       + sugar["hand"] * hand_t)
            labeled[team].append((s, a, partial))
        buf[team] = keep


# --- exam: mirrored pairs vs the frozen champion on held-out decks ---------

@torch.no_grad()
def _exam_game(net_l, net_c, pair_seed: int, flip: bool,
               win: int, lose: int, deck_fn):
    """Learner (side 0) vs champion, both pure argmax. Returns
    (learner_won, [per-hand diff for learner], hands)."""
    env = SelfPlayGame(seed=pair_seed, deck_fn=deck_fn,
                       dealer=pair_seed % 4, win_score=win, lose_score=lose)
    rng = random.Random(pair_seed ^ 0xE7A3)
    team_l = 1 if flip else 0
    while not env.done:
        seat, dtype, cands = env.decision()
        net = net_l if team_of(seat) == team_l else net_c
        j = pick(net, env, seat, dtype, cands, 0.0, rng)
        env.apply(cands[j])
    g = env.g
    diffs = [int(h[4] - h[5]) if team_l == 0 else int(h[5] - h[4])
             for h in g.hand_history]
    return (g.winner == team_l), diffs, len(g.hand_history)


def exam_pair(net_l, net_c, decks: CuratedDecks, pair_seed: int,
              win: int, lose: int):
    """One mirrored pair on identical curated decks. Returns
    (wins, hands, tier_tally[3][3]) — tally rows per tier:
    [learner_both, champ_both, cards_decided]."""
    deck_fn1, tier_of = decks.deck_fn_for(pair_seed)
    deck_fn2, _ = decks.deck_fn_for(pair_seed)
    w1, d1, h1 = _exam_game(net_l, net_c, pair_seed, False, win, lose, deck_fn1)
    w2, d2, h2 = _exam_game(net_l, net_c, pair_seed, True, win, lose, deck_fn2)
    tally = [[0, 0, 0] for _ in range(3)]
    for k in range(min(len(d1), len(d2))):
        t = tier_of(k)
        if d1[k] > 0 and d2[k] > 0:
            tally[t][0] += 1
        elif d1[k] < 0 and d2[k] < 0:
            tally[t][1] += 1
        else:
            tally[t][2] += 1
    return (1 if w1 else 0) + (1 if w2 else 0), h1 + h2, tally


# --- workers ----------------------------------------------------------------

_W: dict = {}


def _winit(lib_path, train_weights, exam_weights, random_decks,
           champ_sd, win, lose):
    torch.set_num_threads(1)
    _W["random"] = random_decks
    if lib_path:
        train, exam, _ = load_library(lib_path)
        _W["train"] = None if random_decks else CuratedDecks(train, train_weights)
        _W["exam"] = CuratedDecks(exam, exam_weights)
    _W["champ"] = _rebuild(champ_sd)
    _W["win"], _W["lose"] = win, lose


def _train_deck_fn(pair_seed):
    if _W.get("train") is None:
        return deck_stream(pair_seed)
    fn, _ = _W["train"].deck_fn_for(pair_seed)
    return fn


def _wmatch(args):
    """One chunk of duplicate pairs between two fighters."""
    sd_a, sd_b, train_a, train_b, eps_a, eps_b, seeds, sugar = args
    na = _rebuild(sd_a) if sd_a is not None else _W["champ"]
    nb = _rebuild(sd_b) if sd_b is not None else _W["champ"]
    rows_a = [] if train_a else None
    rows_b = [] if train_b else None
    wins_a = games = hands = 0
    for ps in seeds:
        deck_fn = _train_deck_fn(ps)
        for flip in (False, True):
            w, nh = play_evo_game(na, nb, ps, flip, eps_a, eps_b,
                                  rows_a, rows_b, sugar,
                                  _W["win"], _W["lose"], deck_fn)
            wins_a += 1 if w == 0 else 0
            games += 1
            hands += nh

    def pack(rows):
        if not rows:
            return None
        return (np.stack([r[0] for r in rows]),
                np.stack([r[1] for r in rows]),
                np.array([r[2] for r in rows], dtype=np.float32))

    return pack(rows_a), pack(rows_b), wins_a, games, hands


def _wexam(args):
    sd_l, seeds = args
    nl = _rebuild(sd_l)
    wins = games = hands = 0
    tally = [[0, 0, 0] for _ in range(3)]
    for ps in seeds:
        w, h, t = exam_pair(nl, _W["champ"], _W["exam"], ps,
                            _W["win"], _W["lose"])
        wins += w
        games += 2
        hands += h
        for i in range(3):
            for j in range(3):
                tally[i][j] += t[i][j]
    return wins, games, hands, tally


# --- the city ---------------------------------------------------------------

def salt(*parts) -> int:
    return zlib.crc32("|".join(str(p) for p in parts).encode()) & 0x7FFFFFFF


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--city", required=True)
    ap.add_argument("--champion", default="models/gen21-cand1.pt")
    ap.add_argument("--learners", type=int, default=6)
    ap.add_argument("--deck-lib", default=None)
    ap.add_argument("--tier-weights", default="0.15,0.35,0.50",
                    help="t0(calm),t1(mid),t2(contested) training mix — "
                         "Riley's rig-the-cards curriculum")
    ap.add_argument("--exam-weights", default="0.10,0.30,0.60",
                    help="FIXED across cities so exams are comparable")
    ap.add_argument("--random-decks", action="store_true",
                    help="control culture: uncurated training decks "
                         "(exams stay curated)")
    ap.add_argument("--win-score", type=int, default=2000)
    ap.add_argument("--lose-score", type=int, default=-1000)
    ap.add_argument("--sugar-bid", type=float, default=0.10)
    ap.add_argument("--sugar-pts", type=float, default=0.15)
    ap.add_argument("--sugar-hand", type=float, default=0.25)
    ap.add_argument("--sugar-game", type=float, default=0.50)
    ap.add_argument("--match-pairs", type=int, default=3,
                    help="duplicate pairs per match per round (marathon "
                         "games are long — keep rounds flowing)")
    ap.add_argument("--rounds", type=int, default=10 ** 9)
    ap.add_argument("--eps", type=float, default=0.05)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--select-every-min", type=float, default=120.0)
    ap.add_argument("--select-pairs", type=int, default=24,
                    help="exam pairs per learner per selection (marathon + "
                         "contested decks ≈ several hundred random sprint "
                         "games of signal)")
    ap.add_argument("--max-hours", type=float, default=12.0)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    sugar = {"bid": args.sugar_bid, "pts": args.sugar_pts,
             "hand": args.sugar_hand, "game": args.sugar_game}
    train_w = tuple(float(x) for x in args.tier_weights.split(","))
    exam_w = tuple(float(x) for x in args.exam_weights.split(","))

    if not args.deck_lib:
        raise SystemExit("--deck-lib is required (even --random-decks "
                         "cities sit curated exams)")
    _, _, lib_stats = load_library(args.deck_lib)

    champ = load_qnet(args.champion)
    champ_sd = {k: v.cpu() for k, v in champ.state_dict().items()}

    names = [FOUNDERS[i] for i in range(args.learners)]
    nets = [_rebuild({k: v.clone() for k, v in champ_sd.items()})
            for _ in range(args.learners)]
    trainable = [True] * args.learners
    for anch in ("gen21", "gen21b"):
        names.append(anch)
        nets.append(champ)
        trainable.append(False)
    opts = [torch.optim.Adam(n.parameters(), lr=args.lr) if tr else None
            for n, tr in zip(nets, trainable)]
    elo = {n: 1000.0 for n in names}
    banked: dict = {}          # name -> (exam_wr, state_dict)
    curve: list = []           # [{ts, round, best, mean}]
    exams: list = []           # selection records
    totals = {"games": 0, "hands": 0, "rows": 0}
    sel_idx = 0
    start_round = 0

    state_path = run_dir / "evo_state.pt"
    if args.resume and state_path.exists():
        st = torch.load(state_path, map_location="cpu", weights_only=False)
        names = list(st["names"])
        nets, opts, trainable = [], [], []
        for nm in names:
            if nm.startswith("gen21"):
                nets.append(champ)
                opts.append(None)
                trainable.append(False)
            else:
                nets.append(_rebuild(st["nets"][nm]))
                opt = torch.optim.Adam(nets[-1].parameters(), lr=args.lr)
                if nm in st["opts"]:
                    try:
                        opt.load_state_dict(st["opts"][nm])
                    except Exception:
                        pass
                opts.append(opt)
                trainable.append(True)
        elo = st["elo"]
        banked = st["banked"]
        curve = st.get("curve", [])
        exams = st.get("exams", [])
        totals = st.get("totals", totals)
        sel_idx = st.get("sel_idx", 0)
        start_round = st["round"] + 1
        print(f"resumed {args.run} at round {start_round} "
              f"(selection {sel_idx})", flush=True)

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    pool = ctx.Pool(args.workers, initializer=_winit,
                    initargs=(args.deck_lib, train_w, exam_w,
                              args.random_decks, champ_sd,
                              args.win_score, args.lose_score))

    def log(rec):
        rec["ts"] = time.time()
        with open(run_dir / "log.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")

    def save_state(rd):
        torch.save({"nets": {nm: nt.state_dict()
                             for nm, nt, tr in zip(names, nets, trainable)
                             if tr},
                    "opts": {nm: op.state_dict()
                             for nm, op, tr in zip(names, opts, trainable)
                             if tr},
                    "elo": elo, "banked": banked, "curve": curve,
                    "exams": exams, "totals": totals, "sel_idx": sel_idx,
                    "round": rd, "names": names}, state_path)

    def write_status(rd, sec_per_round):
        best = max(((v[0], k) for k, v in banked.items() if v[1] is not None),
                   default=(None, None))
        status = {
            "city": args.city, "run": args.run, "ts": time.time(),
            "round": rd, "totals": totals,
            "rate_games_day": round(86400 / sec_per_round
                                    * status_games_last, 0)
            if sec_per_round else None,
            "elo": {k: round(v, 1) for k, v in elo.items()},
            "lineages": {k: round(v[0], 3) for k, v in banked.items()},
            "best": {"wr": best[0], "name": best[1]},
            "curve": curve[-200:],
            "exams": exams[-12:],
            "config": {"tier_weights": list(train_w),
                       "exam_weights": list(exam_w),
                       "random_decks": args.random_decks,
                       "lr": args.lr, "eps": args.eps, "sugar": sugar,
                       "win": args.win_score, "lose": args.lose_score,
                       "select_every_min": args.select_every_min,
                       "select_pairs": args.select_pairs,
                       "lib": lib_stats},
        }
        tmp = run_dir / "status.json.tmp"
        tmp.write_text(json.dumps(status))
        tmp.replace(run_dir / "status.json")

    t_start = time.time()
    last_sel = time.time()
    status_games_last = 0
    print(f"DARWIN GYM {args.city} ({args.run}): {args.learners} learners "
          f"from {args.champion} + 2 anchors | decks "
          f"{'RANDOM (control)' if args.random_decks else train_w} | "
          f"rules {args.lose_score}..{args.win_score} | lr {args.lr}",
          flush=True)

    for rd in range(start_round, args.rounds):
        if (time.time() - t_start) > args.max_hours * 3600:
            print(f"max-hours reached at round {rd} — clean exit", flush=True)
            save_state(rd)
            break
        t0 = time.time()

        # matchmaking: Elo-adjacent pairs, never anchor-vs-anchor
        while True:
            order = sorted(range(len(nets)),
                           key=lambda i: elo[names[i]] + rng.gauss(0, 60))
            pairs = [(order[k], order[k + 1])
                     for k in range(0, len(order) - 1, 2)]
            if not any(not trainable[i] and not trainable[j]
                       for i, j in pairs):
                break

        chunks = max(1, (args.workers + len(pairs) - 1) // len(pairs))
        per = max(1, args.match_pairs // chunks + (args.match_pairs % chunks > 0))
        jobs, meta = [], []
        for pi, (i, j) in enumerate(pairs):
            sd_i = ({k: v.cpu() for k, v in nets[i].state_dict().items()}
                    if trainable[i] else None)
            sd_j = ({k: v.cpu() for k, v in nets[j].state_dict().items()}
                    if trainable[j] else None)
            for _ in range(chunks):
                seeds = [rng.randrange(1 << 30) for _ in range(per)]
                jobs.append((sd_i, sd_j, trainable[i], trainable[j],
                             args.eps if trainable[i] else 0.0,
                             args.eps if trainable[j] else 0.0,
                             seeds, sugar))
                meta.append(pi)
        results = pool.map(_wmatch, jobs)

        agg = {pi: [[], [], 0, 0] for pi in range(len(pairs))}
        for pi, (pa, pb, wins_a, games, hands) in zip(meta, results):
            if pa is not None:
                agg[pi][0].append(pa)
            if pb is not None:
                agg[pi][1].append(pb)
            agg[pi][2] += wins_a
            agg[pi][3] += games
            totals["games"] += games
            totals["hands"] += hands
        round_games = sum(a[3] for a in agg.values())
        status_games_last = round_games

        for pi, (i, j) in enumerate(pairs):
            packs_a, packs_b, wins_a, n = agg[pi]
            if n == 0:
                continue
            elo[names[i]], elo[names[j]] = _elo_update(
                elo[names[i]], elo[names[j]], wins_a / n)
            for idx, packs in ((i, packs_a), (j, packs_b)):
                if not packs or not trainable[idx]:
                    continue
                S = torch.from_numpy(np.concatenate([p[0] for p in packs]))
                A = torch.from_numpy(np.concatenate([p[1] for p in packs]))
                Y = torch.from_numpy(np.concatenate([p[2] for p in packs]))
                totals["rows"] += len(Y)
                net, opt = nets[idx], opts[idx]
                net.train()
                for _ in range(args.epochs):
                    perm = torch.randperm(len(Y))
                    for b in range(0, len(Y), args.batch_size):
                        bi = perm[b:b + args.batch_size]
                        loss = torch.nn.functional.mse_loss(
                            net(S[bi], A[bi]), Y[bi])
                        opt.zero_grad()
                        loss.backward()
                        torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                        opt.step()
                net.eval()

        sec = time.time() - t0
        rec = {"round": rd, "games": round_games, "sec": round(sec, 1),
               "elo": {k: round(v, 1) for k, v in elo.items()}}
        board = sorted(elo.items(), key=lambda kv: -kv[1])
        print(f"[{args.city} rd {rd}] {round_games}g {sec:.0f}s | "
              + "  ".join(f"{k}:{v:.0f}" for k, v in board[:4]), flush=True)

        # --- SELECTION: the salted exam, banking, clone-and-cull ----------
        if (time.time() - last_sel) >= args.select_every_min * 60:
            sel_idx += 1
            base = salt(args.city, sel_idx, time.strftime("%Y%m%d"))
            exam_seeds = [base + p * 104729 + 1
                          for p in range(args.select_pairs)]
            jobs = []
            meta2 = []
            per_w = max(2, args.select_pairs // args.workers + 1)
            for idx in range(len(nets)):
                if not trainable[idx]:
                    continue
                sd = {k: v.cpu() for k, v in nets[idx].state_dict().items()}
                for c in range(0, len(exam_seeds), per_w):
                    jobs.append((sd, exam_seeds[c:c + per_w]))
                    meta2.append(idx)
            eres = pool.map(_wexam, jobs)
            fitness: dict = {}
            tiers: dict = {}
            for idx, (wins, games, hands, tally) in zip(meta2, eres):
                f0 = fitness.setdefault(idx, [0, 0])
                f0[0] += wins
                f0[1] += games
                t0_ = tiers.setdefault(idx, [[0, 0, 0] for _ in range(3)])
                for i in range(3):
                    for j in range(3):
                        t0_[i][j] += tally[i][j]
                totals["games"] += games
                totals["hands"] += hands
            fitness = {i: w / max(1, g) for i, (w, g) in fitness.items()}
            exam_names = dict(enumerate(names))  # pre-swap names for records
            for idx, wr in fitness.items():
                prev = banked.get(names[idx], (-1.0, None))[0]
                if wr > prev:
                    banked[names[idx]] = (
                        wr, {k: v.clone()
                             for k, v in nets[idx].state_dict().items()})
            ranked = sorted(fitness, key=lambda i: fitness[i])
            best_pool = sorted(((nm, v) for nm, v in banked.items()
                                if v[1] is not None),
                               key=lambda kv: -kv[1][0])[:2]
            swaps = []
            for slot, (src_name, (src_wr, src_sd)) in zip(ranked[:2],
                                                          best_pool):
                if fitness[slot] >= src_wr:
                    continue
                nets[slot] = _rebuild({k: v.clone()
                                       for k, v in src_sd.items()})
                opts[slot] = torch.optim.Adam(nets[slot].parameters(),
                                              lr=args.lr)
                old = names[slot]
                new = f"{src_name}.c{rd}"
                names[slot] = new
                elo[new] = elo.pop(old, 1000.0)
                banked[new] = (src_wr, {k: v.clone()
                                        for k, v in src_sd.items()})
                banked.pop(old, None)
                swaps.append(f"{old}=>{new}@{src_wr:.0%}")

            def tier_view(t):
                out = {}
                for i, lbl in enumerate(("calm", "mid", "contested")):
                    l, c, cards = t[i]
                    skill = l + c
                    out[lbl] = {"skill_share":
                                round(l / skill, 3) if skill else None,
                                "skill_hands": skill, "cards_hands": cards}
                return out

            sel_rec = {"sel": sel_idx, "round": rd, "ts": time.time(),
                       "fitness": {exam_names[i]: round(w, 3)
                                   for i, w in fitness.items()},
                       "tiers": {exam_names[i]: tier_view(t)
                                 for i, t in tiers.items()},
                       "swaps": swaps,
                       "pairs": args.select_pairs}
            exams.append(sel_rec)
            wrs = list(fitness.values())
            curve.append({"ts": time.time(), "round": rd,
                          "best": round(max(wrs), 3),
                          "mean": round(sum(wrs) / len(wrs), 3)})
            best_name, best_v = max(banked.items(), key=lambda kv: kv[1][0])
            torch.save({"model": best_v[1], "exam_wr": best_v[0],
                        "name": best_name, "city": args.city,
                        "round": rd, "ts": time.time()},
                       run_dir / "best_banked.pt")
            rec["selection"] = sel_rec
            print(f"  SELECTION {sel_idx}: "
                  + "  ".join(f"{exam_names[i]}={fitness[i]:.0%}"
                              for i in sorted(fitness,
                                              key=lambda i: -fitness[i]))
                  + ("  | " + ", ".join(swaps) if swaps else "  | no swaps"),
                  flush=True)
            last_sel = time.time()
            save_state(rd)

        log(rec)
        if rd % 25 == 0:
            write_status(rd, sec)
        if rd % 200 == 0 and rd > start_round:
            save_state(rd)
    pool.close()


if __name__ == "__main__":
    main()
