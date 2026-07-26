"""THE DARWIN GYM v2 (Riley's design + launch-night lessons, gen22 era):
evolution on top of gen21, fed a contested-deal curriculum.

One gym = one city of 6 learners, every one born a byte-copy of the frozen
champion gen21, with the champion itself as the permanent sparring partner
(Riley's "frozen gen21 always at the table").

THE LEARNING RULE — verified self-imitation on mirrored hands. gen21 is a
behavior clone: its outputs are CE logits (measured -111..+52), NOT values,
so any outcome-regression (every sugar recipe, even the proven native
target) re-scales the whole function and wrecked learners to 0-3% within
one selection cycle. Value targets are therefore BANNED in this gym.
Instead, the only currency is the one gen21 was raised in — cross-entropy
over actions (law 6, spotless record) — and the only teacher is VERIFIED
advantage:

  * a training unit is a MIRRORED HAND-PAIR: one curated deal, played
    twice with chairs swapped — learner (eps-dithered) vs frozen gen21
    (pure argmax) — from the same sampled score-start (gen_mimic's
    curriculum, the distribution gen21 was trained on). Single hands, not
    full games: marathon mirrors diverge in score context by mid-game,
    which poisoned the credit (v2's first smoke);
  * adv = d1 - d2 (team0-cards swing, game1 minus game2) — zero-sum
    mirror, so adv > 0 means the learner out-scored gen21's own line
    from BOTH holdings of the same cards, luck fully cancelled (Riley's
    hand-pair decomposition, used as the reward);
  * adv > 0: the learner's decisions that hand (both games) become CE
    targets at weight min(1, adv/200) — clone your verified wins;
  * adv < 0: gen21's decisions that hand become the CE targets — pulled
    back toward the champion exactly where you played worse. The rule is
    self-stabilizing: a learner can drift only by accumulating lines
    that measurably beat the champion's.

Selection (Riley's clone-and-cull, unchanged): every 2h all learners sit
the same salted exam — mirrored duplicate MARATHON games vs frozen gen21
on HELD-OUT contested decks. Best-ever weights bank per lineage (seeded
with a pristine champion copy at its mirror-true 50% — the ratchet floor:
the population can never do worse than restart from gen21). Bottom two are
replaced by clones of the two best banks, pedigree names parent.c<round>.

Cities differ by culture (tier weights, lr, eps); city 4 runs
--random-decks as the CONTROL: if curation is the active ingredient, it
must fall behind.

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
from .league import pick, _rebuild
from .contested import load_library, CuratedDecks, deal_deck
from .gen_mimic import sample_start

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"
FOUNDERS = "ABCDEF"
MAX_CANDS = 16


# --- the farm: mirrored single hands vs the frozen champion ----------------

@torch.no_grad()
def play_mirror_hand(net_l, net_c, deal_seed: int, start, flip: bool,
                     eps: float, rng, win: int, lose: int):
    """One single hand: learner vs champion on a fixed deal from a fixed
    score-start; learner is team0 unless flip. Returns (d, rows_l, rows_c)
    where d = team0-cards swing and rows = (state, dtype, cands, chosen)."""
    deck0 = deal_deck(deal_seed)

    def deck_fn(i: int):
        if i == 0:
            return deck0
        d = list(deck0)  # redeal escape (engine redeals fire at deal time)
        random.Random(deal_seed ^ (i * 0x9E3779B1)).shuffle(d)
        return d

    env = SelfPlayGame(seed=deal_seed, dealer=deal_seed % 4,
                       deck_fn=deck_fn, win_score=win, lose_score=lose)
    env.g.scores = list(start)
    team_l = 1 if flip else 0
    rows_l, rows_c = [], []
    while not env.done and not env.g.hand_history:
        if env.deal_count > 1:
            return None, None, None  # engine redeal: skip the deal
        seat, dtype, cands = env.decision()
        is_l = team_of(seat) == team_l
        net = net_l if is_l else net_c
        j = pick(net, env, seat, dtype, cands, eps if is_l else 0.0, rng)
        if len(cands) > 1:
            s = encode_state_for(net, observe(env.g, seat), env.picks,
                                 dtype, env.g, env.trump_intent)
            if is_l:
                # the NEEDLE flag: does this choice differ from what the
                # frozen champion would play here? (mimic-era override
                # lesson: the disagreements carry the signal)
                S = torch.from_numpy(np.stack([s] * len(cands)))
                A = torch.from_numpy(np.stack(
                    [encode_action(dtype, a) for a in cands]))
                jc = int(net_c(S, A).argmax().item())
                rows_l.append((s, dtype, tuple(cands), j, j != jc))
            else:
                rows_c.append((s, dtype, tuple(cands), j, False))
        env.apply(cands[j])
    if not env.g.hand_history:
        return None, None, None  # game ended before the hand completed
    h = env.g.hand_history[0]
    return int(h[4] - h[5]), rows_l, rows_c


def farm_pair(net_l, net_c, deal_seed: int, start, eps: float, rng,
              win: int, lose: int, needle_w: float = 4.0):
    """One mirrored hand-pair. Returns (adv, rows, weight): rows are the
    CE targets — the learner's lines if adv>0, the champion's if adv<0;
    None if the deal redealt."""
    d1, l1, c1 = play_mirror_hand(net_l, net_c, deal_seed, start, False,
                                  eps, rng, win, lose)
    if d1 is None:
        return None
    d2, l2, c2 = play_mirror_hand(net_l, net_c, deal_seed, start, True,
                                  eps, rng, win, lose)
    if d2 is None:
        return None
    adv = d1 - d2
    if adv == 0:
        return 0, [], 0.0
    base = min(1.0, abs(adv) / 200.0)
    rows = (l1 + l2) if adv > 0 else (c1 + c2)
    return adv, [(s, dt, cands, j,
                  base * (needle_w if needle else 1.0))
                 for s, dt, cands, j, needle in rows], base


# --- workers ----------------------------------------------------------------

_W: dict = {}


def _winit(lib_path, train_weights, exam_weights, random_decks,
           champ_sd, win, lose, farm_win, farm_lose, curriculum,
           needle_w):
    torch.set_num_threads(1)
    train, exam, _ = load_library(lib_path)
    _W["train"] = None if random_decks else train
    _W["train_w"] = train_weights
    _W["exam"] = CuratedDecks(exam, exam_weights)
    _W["champ"] = _rebuild(champ_sd)
    _W["win"], _W["lose"] = win, lose
    _W["fwin"], _W["flose"] = farm_win, farm_lose
    _W["curriculum"] = curriculum
    _W["needle_w"] = needle_w


def _sample_deal(rng):
    if _W["train"] is None:
        return rng.randrange(1, 1 << 30)  # control city: any deal
    t = rng.choices((0, 1, 2), weights=_W["train_w"])[0]
    tier = _W["train"][t] or _W["train"][2] or _W["train"][1]
    return rng.choice(tier)


def _wfarm(args):
    """One chunk of mirrored hand-pairs for one learner."""
    sd_l, seed_base, n_pairs, eps = args
    nl = _rebuild(sd_l)
    rng = random.Random(seed_base)
    rows_out = []
    pos = neg = tied = hands = 0
    adv_sum = 0
    for _ in range(n_pairs):
        deal = _sample_deal(rng)
        start = sample_start(rng, _W["curriculum"])
        r = farm_pair(nl, _W["champ"], deal, start, eps, rng,
                      _W["fwin"], _W["flose"], _W["needle_w"])
        if r is None:
            continue
        adv, rows, _w = r
        hands += 2
        if adv > 0:
            pos += 1
            adv_sum += adv
        elif adv < 0:
            neg += 1
            adv_sum += adv
        else:
            tied += 1
        rows_out.extend(rows)

    def pack(rows):
        if not rows:
            return None
        return (np.stack([r[0] for r in rows]),
                [(r[1], r[2], r[3], r[4]) for r in rows])

    return pack(rows_out), pos, neg, tied, hands, adv_sum


def ce_step(net, opt, packs, batch_size: int, epochs: int):
    """Masked-candidate cross-entropy — the mimic trainer's shape; the
    teacher is the mirror-verified line (own win or champion pull-back).
    Returns (rows, mean_loss)."""
    S = torch.from_numpy(np.concatenate([p[0] for p in packs]))
    meta = [m for p in packs for m in p[1]]
    B = len(meta)
    A = torch.zeros(B, MAX_CANDS, 50)
    mask = torch.full((B, MAX_CANDS), False)
    tgt = torch.zeros(B, dtype=torch.long)
    wgt = torch.zeros(B)
    for i, (dtype, cands, j, w) in enumerate(meta):
        for c, a in enumerate(cands[:MAX_CANDS]):
            A[i, c] = torch.from_numpy(encode_action(dtype, a))
            mask[i, c] = True
        tgt[i] = min(j, MAX_CANDS - 1)
        wgt[i] = w
    net.train()
    losses = []
    for _ in range(epochs):
        perm = torch.randperm(B)
        for b in range(0, B, batch_size):
            bi = perm[b:b + batch_size]
            nb_ = len(bi)
            Se = S[bi].unsqueeze(1).expand(-1, MAX_CANDS, -1).reshape(
                nb_ * MAX_CANDS, -1)
            Ae = A[bi].reshape(nb_ * MAX_CANDS, -1)
            logits = net(Se, Ae).view(nb_, MAX_CANDS)
            logits = logits.masked_fill(~mask[bi], -1e9)
            ce = torch.nn.functional.cross_entropy(logits, tgt[bi],
                                                   reduction="none")
            loss = (ce * wgt[bi]).sum() / wgt[bi].sum().clamp_min(1e-6)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            losses.append(float(loss.detach()))
    net.eval()
    return B, (sum(losses) / len(losses) if losses else 0.0)


# --- exam: mirrored duplicate MARATHON games vs the champion ---------------

@torch.no_grad()
def _exam_game(net_l, net_c, pair_seed: int, flip: bool,
               win: int, lose: int, deck_fn):
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
    """One mirrored marathon pair on identical curated decks. Returns
    (wins, hands, tier_tally[3][3]) — per tier:
    [learner_both, champ_both, cards_decided]."""
    deck_fn1, tier_of = decks.deck_fn_for(pair_seed)
    deck_fn2, _ = decks.deck_fn_for(pair_seed)
    w1, d1, h1 = _exam_game(net_l, net_c, pair_seed, False, win, lose,
                            deck_fn1)
    w2, d2, h2 = _exam_game(net_l, net_c, pair_seed, True, win, lose,
                            deck_fn2)
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
                    help="control culture: uncurated training deals "
                         "(exams stay curated)")
    ap.add_argument("--win-score", type=int, default=2000,
                    help="EXAM rules (marathon; Riley's -1000..2000)")
    ap.add_argument("--lose-score", type=int, default=-1000)
    ap.add_argument("--farm-win", type=int, default=500,
                    help="farm hands use sprint geometry — the score "
                         "distribution gen21 was trained on")
    ap.add_argument("--farm-lose", type=int, default=-250)
    ap.add_argument("--needle-weight", type=float, default=4.0,
                    help="CE weight multiplier for verified-win rows where "
                         "the learner DISAGREED with the champion (the "
                         "mimic override lesson)")
    ap.add_argument("--curriculum", type=float, default=0.4,
                    help="fraction of farm hands from random score starts "
                         "(gen_mimic's own curriculum)")
    ap.add_argument("--farm-pairs", type=int, default=48,
                    help="mirrored hand-pairs per learner per round")
    ap.add_argument("--rounds", type=int, default=10 ** 9)
    ap.add_argument("--eps", type=float, default=0.05)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--workers", type=int, default=7)
    ap.add_argument("--select-every-min", type=float, default=120.0)
    ap.add_argument("--select-pairs", type=int, default=75,
                    help="exam pairs per learner per selection — 150 "
                         "marathon games (SE ~4pp) on contested decks")
    ap.add_argument("--max-hours", type=float, default=12.0)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    run_dir = RUNS_DIR / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
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
    opts = [torch.optim.Adam(n.parameters(), lr=args.lr) for n in nets]
    banked: dict = {}
    curve: list = []
    exams: list = []
    totals = {"games": 0, "hands": 0, "rows": 0, "pos": 0, "neg": 0}
    sel_idx = 0
    start_round = 0

    state_path = run_dir / "evo_state.pt"
    if args.resume and state_path.exists():
        st = torch.load(state_path, map_location="cpu", weights_only=False)
        names = list(st["names"])
        nets, opts = [], []
        for nm in names:
            nets.append(_rebuild(st["nets"][nm]))
            opt = torch.optim.Adam(nets[-1].parameters(), lr=args.lr)
            if nm in st["opts"]:
                try:
                    opt.load_state_dict(st["opts"][nm])
                except Exception:
                    pass
            opts.append(opt)
        banked = st["banked"]
        curve = st.get("curve", [])
        exams = st.get("exams", [])
        totals = st.get("totals", totals)
        sel_idx = st.get("sel_idx", 0)
        start_round = st["round"] + 1
        print(f"resumed {args.run} at round {start_round} "
              f"(selection {sel_idx})", flush=True)

    # RATCHET FLOOR: every lineage's bank starts as a pristine champion
    # copy at its mirror-true 50% — the cull pulls wrecked fighters back
    # to fresh gen21 clones; the population can never do worse than
    # restart from the champion.
    for nm in names:
        if nm not in banked:
            banked[nm] = (0.50, {k: v.clone() for k, v in champ_sd.items()})

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    pool = ctx.Pool(args.workers, initializer=_winit,
                    initargs=(args.deck_lib, train_w, exam_w,
                              args.random_decks, champ_sd,
                              args.win_score, args.lose_score,
                              args.farm_win, args.farm_lose,
                              args.curriculum, args.needle_weight))

    def log(rec):
        rec["ts"] = time.time()
        with open(run_dir / "log.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")

    def save_state(rd):
        torch.save({"nets": {nm: nt.state_dict()
                             for nm, nt in zip(names, nets)},
                    "opts": {nm: op.state_dict()
                             for nm, op in zip(names, opts)},
                    "banked": banked, "curve": curve, "exams": exams,
                    "totals": totals, "sel_idx": sel_idx,
                    "round": rd, "names": names}, state_path)

    def write_status(rd, sec_per_round, last_pos_rate):
        best = max(((v[0], k) for k, v in banked.items()
                    if v[1] is not None), default=(None, None))
        status = {
            "city": args.city, "run": args.run, "ts": time.time(),
            "round": rd, "totals": totals,
            "pos_rate": last_pos_rate,
            "rate_games_day": round(86400 / sec_per_round
                                    * status_pairs_last * 2, 0)
            if sec_per_round else None,
            "lineages": {k: round(v[0], 3) for k, v in banked.items()},
            "best": {"wr": best[0], "name": best[1]},
            "curve": curve[-200:],
            "exams": exams[-12:],
            "config": {"tier_weights": list(train_w),
                       "exam_weights": list(exam_w),
                       "random_decks": args.random_decks,
                       "lr": args.lr, "eps": args.eps,
                       "win": args.win_score, "lose": args.lose_score,
                       "farm": [args.farm_lose, args.farm_win,
                                args.curriculum],
                       "select_every_min": args.select_every_min,
                       "select_pairs": args.select_pairs,
                       "lib": lib_stats},
        }
        tmp = run_dir / "status.json.tmp"
        tmp.write_text(json.dumps(status))
        tmp.replace(run_dir / "status.json")

    t_start = time.time()
    last_sel = time.time()
    status_pairs_last = 0
    pos_rate = None
    print(f"DARWIN GYM v2 {args.city} ({args.run}): {args.learners} "
          f"learners from {args.champion} | mirrored-hand farm vs frozen "
          f"champion, CE self-imitation | decks "
          f"{'RANDOM (control)' if args.random_decks else train_w} | "
          f"exam rules {args.lose_score}..{args.win_score} | lr {args.lr} "
          f"eps {args.eps}", flush=True)

    for rd in range(start_round, args.rounds):
        if (time.time() - t_start) > args.max_hours * 3600:
            print(f"max-hours reached at round {rd} — clean exit",
                  flush=True)
            save_state(rd)
            break
        t0 = time.time()

        # --- FARM: every learner works a chunk of mirrored hand-pairs ---
        chunks = max(1, args.workers // max(1, len(nets)))
        per = max(4, args.farm_pairs // chunks)
        jobs, meta = [], []
        for idx in range(len(nets)):
            sd = {k: v.cpu() for k, v in nets[idx].state_dict().items()}
            for c in range(chunks):
                jobs.append((sd, rng.randrange(1 << 30), per, args.eps))
                meta.append(idx)
        results = pool.map(_wfarm, jobs)

        agg: dict = {}
        pos = neg = tied = 0
        adv_sum = 0
        for idx, (pk, p, n_, t, hands, a) in zip(meta, results):
            if pk is not None:
                agg.setdefault(idx, []).append(pk)
            pos += p
            neg += n_
            tied += t
            adv_sum += a
            totals["games"] += 2 * (p + n_ + t)
            totals["hands"] += hands
        totals["pos"] += pos
        totals["neg"] += neg
        status_pairs_last = pos + neg + tied

        round_rows = 0
        losses = []
        for idx, packs in agg.items():
            nrows, loss = ce_step(nets[idx], opts[idx], packs,
                                  args.batch_size, args.epochs)
            totals["rows"] += nrows
            round_rows += nrows
            losses.append(loss)

        decided = pos + neg
        pos_rate = round(pos / decided, 3) if decided else None
        sec = time.time() - t0
        rec = {"round": rd, "pairs": pos + neg + tied, "pos": pos,
               "neg": neg, "pos_rate": pos_rate,
               "adv_mean": round(adv_sum / max(1, decided), 1),
               "rows": round_rows, "sec": round(sec, 1),
               "ce": round(sum(losses) / len(losses), 4) if losses
               else None}
        print(f"[{args.city} rd {rd}] {pos + neg + tied}pr "
              f"+{pos}/-{neg} pos_rate "
              f"{pos_rate if pos_rate is not None else '—'} "
              f"rows {round_rows} {sec:.0f}s", flush=True)

        # --- SELECTION: the salted exam, banking, clone-and-cull --------
        if (time.time() - last_sel) >= args.select_every_min * 60:
            sel_idx += 1
            base = salt(args.city, sel_idx, time.strftime("%Y%m%d"))
            exam_seeds = [base + p * 104729 + 1
                          for p in range(args.select_pairs)]
            jobs2, meta2 = [], []
            per_w = max(2, args.select_pairs // args.workers + 1)
            for idx in range(len(nets)):
                sd = {k: v.cpu() for k, v in nets[idx].state_dict().items()}
                for c in range(0, len(exam_seeds), per_w):
                    jobs2.append((sd, exam_seeds[c:c + per_w]))
                    meta2.append(idx)
            eres = pool.map(_wexam, jobs2)
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
            exam_names = dict(enumerate(names))
            # CONFIRM-BEFORE-BANKING (law 2): a prospective bank overwrite
            # must repeat on a second, differently-salted paper; the bank
            # records the CONFIRM value (unbiased — kills the max-over-
            # noisy-exams froth that read 62% and dueled 50%).
            cand_idxs = [i for i, wr in fitness.items()
                         if wr > banked.get(names[i], (-1.0, None))[0]]
            confirms: dict = {}
            if cand_idxs:
                cbase = salt(args.city, sel_idx, "confirm",
                             time.strftime("%Y%m%d"))
                cseeds = [cbase + p * 104729 + 1
                          for p in range(args.select_pairs)]
                jobs3, meta3 = [], []
                for idx in cand_idxs:
                    sd = {k: v.cpu()
                          for k, v in nets[idx].state_dict().items()}
                    for c in range(0, len(cseeds), per_w):
                        jobs3.append((sd, cseeds[c:c + per_w]))
                        meta3.append(idx)
                cres = pool.map(_wexam, jobs3)
                cagg: dict = {}
                for idx, (wins, games, hands, _t) in zip(meta3, cres):
                    c0 = cagg.setdefault(idx, [0, 0])
                    c0[0] += wins
                    c0[1] += games
                    totals["games"] += games
                    totals["hands"] += hands
                confirms = {i: w / max(1, g) for i, (w, g) in cagg.items()}
            for idx, wr in fitness.items():
                prev = banked.get(names[idx], (-1.0, None))[0]
                if wr <= prev:
                    continue
                val = confirms.get(idx, wr)
                # banks only move on DISTINGUISHABLE evidence (+2pp over
                # the incumbent): keeps pristine-gen21 seeds as clone
                # sources until a fighter is genuinely better, and stops
                # noise-creep ratcheting the floor downward
                if val > prev + 0.02:
                    banked[names[idx]] = (
                        val, {k: v.clone()
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
                                "skill_hands": skill,
                                "cards_hands": cards}
                return out

            sel_rec = {"sel": sel_idx, "round": rd, "ts": time.time(),
                       "fitness": {exam_names[i]: round(w, 3)
                                   for i, w in fitness.items()},
                       "tiers": {exam_names[i]: tier_view(t)
                                 for i, t in tiers.items()},
                       "swaps": swaps,
                       "confirms": {exam_names[i]: round(w, 3)
                                    for i, w in confirms.items()},
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
            write_status(rd, sec, pos_rate)
        if rd % 100 == 0 and rd > start_round:
            save_state(rd)
    pool.close()


if __name__ == "__main__":
    main()
