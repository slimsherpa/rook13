"""The cardplay gym's data engine (gen24 — the CardBrain corpus, 2026-08-01).

Twin-DECISION corpus for card play, Riley's design: gen23 plays whole
games; at sampled card-play decisions the world is FROZEN and every
legal card is rolled out to the end of the HAND in that same world —
same deal, same auction, same widow, same downstream policy in all four
seats. Each candidate's label is its own team's hand score minus the
score of gen23's actual line: the pure causal effect of that one card,
with deal luck and every shared decision cancelled. PER HAND, not per
game (Riley's currency call). The continuation policy is deterministic,
so one rollout per candidate is exact — there is no label noise to
average away, only the (recorded) fact that the label is conditional on
gen23 finishing the hand.

No categories, no strategy templates (the widow gym's lesson): raw
candidates, raw advantages. The study slices afterward.

Self-check, every row (test-the-test is built in): the CHOSEN card's
rollout must reproduce the real game's hand outcome exactly — same
policy, same world, so any mismatch means hidden state leaked into the
rollout and the row is dropped and counted in the shard's `bad` field.

Records are raw-replayable (seed + hand number + decision ordinal, with
the engine's deck_stream) and ALSO carry the packed encoder-v4 state
(b64 float16) so training needs no replay mill. The state is everything
a human in that chair can see — scorecard, dealer, full auction, trump,
played cards, points captured (house rule #1: never strip the view).
If the encoder ever evolves, re-mill from the raw keys.

    ~/torch-env/bin/python -m alpharook.cardgym_data --minutes 20 --workers 4

Shards: runs/gen24/cardgym/shards/<tag>_wN_XXXX.jsonl — one line per
snapshot; whole shards only (tmp-rename).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import random
import time

import numpy as np
import torch

from rook.cards import team_of
from rook.determinize import sample_world, sample_world_weighted
from rook.engine import HAND_DONE, GAME_OVER
from rook.observation import observe
from .arena import model_choose
from .duel import deck_stream
from .encoder import D_PLAY, encode_state_for
from .env import SelfPlayGame
from .model import load_qnet

OUT_DIR = "runs/gen24/cardgym/shards"
ROWS_PER_SHARD = 400
SNAP_P = 0.20            # chance a multi-option play decision is snapshotted


def pack_state(vec: np.ndarray) -> str:
    return base64.b64encode(vec.astype(np.float16).tobytes()).decode()


def unpack_state(s: str, dim: int) -> np.ndarray:
    v = np.frombuffer(base64.b64decode(s), dtype=np.float16)
    assert len(v) == dim, f"packed state dim {len(v)} != {dim}"
    return v.astype(np.float32)


def rollout_hand(g0, seat: int, card: int, net):
    """Freeze the world, play `card` from `seat`, let the net finish the
    hand in all four chairs. Returns the decider's TEAM score for the hand."""
    g = g0.clone()

    class _E:
        pass
    e = _E()
    e.g = g
    e.picks = []
    e.trump_intent = None
    g.play_card(seat, card)
    hn = None
    while g.phase not in (HAND_DONE, GAME_OVER):
        s = g.turn
        g.play_card(s, model_choose(net, "cpu", e, s, D_PLAY,
                                    g.legal_cards(s)))
    h = g.hand_history[-1]
    team = team_of(seat)
    return int(h[4] if team == 0 else h[5]), h[0]


@torch.no_grad()
def harvest_game(net, seed: int, snap_p: float, rng: random.Random,
                 worlds: int = 0, belief=None, early_focus: bool = False):
    """One full gen23 self-play game. Returns snapshot rows, each with the
    full candidate advantage curve, plus (rows, bad) counts.

    worlds=0 (v1): labels come from the one TRUE world — exact per world,
    but E[adv|obs] is left to the net to average across states. Measured
    honest negative at 900k rows (quiz -3.2 ± 1.5 vs gen23).
    worlds=K (v2): labels are the MEAN advantage over K observation-
    consistent worlds sampled from the belief posterior (gen15 @ temp,
    the t0 teacher's imagination). The label is then a function of the
    observation ONLY — no peeking even in expectation — and the world-
    marginalization happens at generation time instead of being asked
    of the net. The true world never enters the label; it only serves
    the integrity self-check."""
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed), dealer=seed % 4)
    snaps = []   # (g0 clone, seat, hn, di, trick, pos, cands, chosen, state)
    di = 0
    while not env.done:
        seat, dtype, cands = env.decision()
        pick = model_choose(net, "cpu", env, seat, dtype, cands)
        trick_now = len(env.g.completed_tricks)
        p_here = snap_p
        if early_focus and trick_now >= 5:
            p_here = snap_p * 0.25
        if (dtype == D_PLAY and len(cands) > 1
                and rng.random() < p_here):
            o = observe(env.g, seat)
            wlds = []
            if worlds > 0:
                try:
                    probs = (belief.posterior(env, seat, o, dtype, cands)
                             if belief is not None else None)
                except Exception:
                    probs = None
                for _ in range(worlds):
                    try:
                        if probs is not None:
                            wlds.append(sample_world_weighted(o, rng, probs))
                        else:
                            wlds.append(sample_world(o, rng))
                    except Exception:
                        continue
            state = encode_state_for(net, o, env.picks,
                                     dtype, env.g, env.trump_intent)
            snaps.append(dict(
                o=o, wlds=wlds,
                win=env.g.win_score, lose=env.g.lose_score,
                g0=env.g.clone(), seat=seat, hn=env.g.hand_number, di=di,
                trick=len(env.g.completed_tricks),
                pos=len(env.g.trick_plays),
                declarer=int(seat == env.g.bid_winner),
                decl_team=int(team_of(seat) == team_of(env.g.bid_winner)),
                bid=int(env.g.high_bid), trump=int(env.g.trump),
                scores=[int(env.g.scores[0]), int(env.g.scores[1])],
                cands=list(cands), chosen=int(pick), state=state))
        di += 1
        env.apply(pick)

    hist = {h[0]: h for h in env.g.hand_history}
    rows, bad = [], 0
    for sn in snaps:
        h = hist.get(sn["hn"])
        if h is None:                       # redeal ate the hand
            continue
        team = team_of(sn["seat"])
        actual = int(h[4] if team == 0 else h[5])
        base, bhn = rollout_hand(sn["g0"], sn["seat"], sn["chosen"], net)
        if base != actual or bhn != sn["hn"]:
            bad += 1                        # self-check: must be impossible
            continue
        if sn["wlds"]:
            # v2: mean advantage across imagined worlds; true world only
            # ever used for the self-check above, never for the label
            from .search import materialize
            per_c = {c: [] for c in sn["cands"]}
            for hands, gd in sn["wlds"]:
                gw = materialize(sn["o"], hands, gd, sn["win"], sn["lose"])
                base_w = None
                for c in sn["cands"]:
                    s, _ = rollout_hand(gw, sn["seat"], c, net)
                    per_c[c].append(s)
                    if c == sn["chosen"]:
                        base_w = s
                for c in sn["cands"]:
                    per_c[c][-1] -= base_w
            k = len(sn["wlds"])
            cands_out = []
            for c in sn["cands"]:
                advs = per_c[c]
                mean_adv = sum(advs) / k
                sd = (sum((a - mean_adv) ** 2 for a in advs) / k) ** 0.5
                cands_out.append(dict(
                    c=int(c), adv=round(mean_adv, 1), sd=round(sd, 1),
                    k=k))
        else:
            cands_out = [dict(c=int(sn["chosen"]), s=base, adv=0)]
            for c in sn["cands"]:
                if c == sn["chosen"]:
                    continue
                s, _ = rollout_hand(sn["g0"], sn["seat"], c, net)
                cands_out.append(dict(c=int(c), s=s, adv=s - base))
        rows.append(dict(
            seed=seed, hn=sn["hn"], di=sn["di"], seat=sn["seat"],
            team=team, trick=sn["trick"], pos=sn["pos"],
            declarer=sn["declarer"], decl_team=sn["decl_team"],
            bid=sn["bid"], trump=sn["trump"], scores=sn["scores"],
            made=int(not h[6]), chosen=int(sn["chosen"]),
            cands=cands_out, x=pack_state(sn["state"])))
    return rows, bad


def worker(worker_id: int, args, run_tag: str):
    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    belief = None
    if args.worlds > 0 and args.belief_ckpt:
        from .beliefs import BeliefOracle
        belief = BeliefOracle(args.belief_ckpt, temp=args.belief_temp)
    os.makedirs(args.out, exist_ok=True)
    rng = random.Random(args.seed_base ^ (worker_id * 7919))
    shard_n = 0
    t_end = time.time() + args.minutes * 60
    seed = args.seed_base + worker_id * 10_000_000
    n_rows = n_bad = n_games = 0
    parent = os.getppid()
    while time.time() < t_end:
        if os.getppid() != parent:          # orphaned: parent was killed
            return
        path = os.path.join(args.out,
                            f"{run_tag}_w{worker_id}_{shard_n:04d}.jsonl")
        tmp = path + ".tmp"
        in_shard = 0
        with open(tmp, "w") as f:
            while in_shard < ROWS_PER_SHARD and time.time() < t_end:
                seed += 1
                rows, bad = harvest_game(net, seed, args.snap_p, rng,
                                         worlds=args.worlds, belief=belief,
                                         early_focus=args.early_focus)
                n_bad += bad
                n_games += 1
                for row in rows:
                    f.write(json.dumps(row) + "\n")
                    in_shard += 1
                    n_rows += 1
        os.replace(tmp, path)
        shard_n += 1
        if worker_id == 0:
            print(f"  [w0] shard {shard_n}: {n_rows} rows / {n_games} games"
                  f" / {n_bad} self-check fails, "
                  f"{(t_end - time.time()) / 60:.0f} min left", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--net", default="models/gen23-cand1.pt")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--seed-base", type=int, default=5_000_000_000)
    ap.add_argument("--snap-p", type=float, default=SNAP_P)
    ap.add_argument("--worlds", type=int, default=0,
                    help="v2: label = mean adv over K belief-sampled "
                         "observation-consistent worlds (0 = true-world v1)")
    ap.add_argument("--belief-ckpt", default="models/gen15.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--early-focus", action="store_true",
                    help="snapshot tricks 5+ at 1/4 rate (headroom lives "
                         "in tricks 0-4 per the gym audit)")
    ap.add_argument("--run-tag", default=None,
                    help="unique shard-name prefix; default derives from "
                         "seed-base (pass a distinct seed-base per run)")
    args = ap.parse_args()
    run_tag = args.run_tag or f"c{args.seed_base % 1_000_000:06d}"
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    procs = [ctx.Process(target=worker, args=(w, args, run_tag))
             for w in range(args.workers)]
    for p in procs:
        p.start()
    print(f"cardplay gym corpus: {args.workers} workers, {args.minutes} min "
          f"-> {args.out}", flush=True)
    for p in procs:
        p.join()
    print("CARDGYM RUN DONE", flush=True)


if __name__ == "__main__":
    main()
