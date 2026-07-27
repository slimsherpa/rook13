"""THE CEILING REPORT — how far is gen21 from perfect?

Riley's question, finally answerable: how much better can these models get?

At every card the model plays, the oracle computes the EXACT value of that
card and of every alternative, given the true layout. The difference is
what the play cost, in points, with no rollout noise anywhere.

Why per-DECISION and not per-hand: in self-play both teams are the same
model, so hand-level gaps to par cancel to zero by construction. Per-
decision loss doesn't cancel — it measures each side's mistakes
separately, and it splits by seat, role and trick.

THE HONEST CAVEAT, up front, because it decides how to read the number:
a double-dummy loss is an UPPER BOUND on real error. Some of it is
genuinely unknowable — you cannot finesse correctly when the card could
be in either hand. So we split it:

    total loss  =  PREVENTABLE  (a mortal seeing only what this seat saw
                                 would still pick the oracle's card)
                +  IRREDUCIBLE  (the right card depended on the hidden
                                 layout; nobody finds it without peeking)

PREVENTABLE is the real headroom — the honest answer to "how much better
can AlphaRook get". IRREDUCIBLE is the luck floor of Rook itself.

The split is the same marginalization that makes an oracle safe to use at
all: never ask "what is best given the truth", only "what is best given
what this seat could see". See rook/solver.py's header and law 9.

Usage (one shard per core):
    python -m alpharook.ceiling --out runs/ceiling/s0.jsonl \\
        --seed-base 1000 --hands 40 --worlds 12
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch

from rook.cards import CARD_POINTS, TAKING_TRICKS_BONUS, team_of
from rook.determinize import sample_world
from rook.engine import PLAYING
from rook.observation import observe
from rook import solver as S

from .arena import model_choose
from .duel import deck_stream
from .env import SelfPlayGame
from .model import load_qnet


def _position(g):
    """Everything the solver needs to describe the live position."""
    return {
        "hands": [list(h) for h in g.hands],
        "trump": g.trump,
        "gd": sum(CARD_POINTS[c] for c in g.go_down),
        "trick": tuple((s, c) for s, c in g.trick_plays),
        "tricks_done": len(g.completed_tricks),
        "t0_tricks": g.tricks_won[0],
        "leader": g.trick_leader,
    }


def decision_loss(p, seat, chosen):
    """(loss_in_points, oracle_card, n_options).

    Two searches, not one per candidate: the position's own value is what
    the best card is worth, and one more search prices the card actually
    played. At trick 0 that is the difference between 2 and 9 full-tree
    solves, which is the whole cost of this report.
    """
    kw = dict(t0_tricks=p["t0_tricks"], tricks_done=p["tricks_done"],
              trick=p["trick"])
    best_v = S.solve(p["hands"], p["trump"], p["leader"], p["gd"], **kw)
    got = S.play_values(p["hands"], p["trump"], p["leader"], p["gd"],
                        only=[chosen], **kw)[chosen]
    loss = (best_v - got) if team_of(seat) == 0 else (got - best_v)
    return max(0.0, float(loss)), None, 2


def knowability(g, seat, p, chosen, n_worlds, rng):
    """Was this card's badness KNOWABLE from where the player sat?

    Sample worlds consistent with this seat's own view and solve each. If
    the card played is still the best choice in most of those worlds, the
    player did nothing wrong — the loss came from the hidden layout and is
    IRREDUCIBLE. If it is bad in world after world, the player could have
    known, and the loss is PREVENTABLE.

    Note we score the card ACTUALLY PLAYED rather than hunting the true
    world's best card: it answers the question we care about, and costs
    one solve per world instead of one per world per candidate.
    """
    if n_worlds <= 0:
        return None, 0
    o = observe(g, seat)
    kw = dict(t0_tricks=p["t0_tricks"], tricks_done=p["tricks_done"],
              trick=p["trick"])
    ok = tried = 0
    for _ in range(n_worlds):
        try:
            hands, _gd = sample_world(o, rng)
        except Exception:
            continue
        if any(len(hands[i]) != len(p["hands"][i]) for i in range(4)):
            continue
        try:
            c, _v = S.best_play(hands, p["trump"], p["leader"], p["gd"],
                                **kw)
        except Exception:
            continue
        tried += 1
        ok += (c == chosen)
    # share of imagined worlds where the played card was right anyway
    return (ok / tried if tried else None), tried


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--hands", type=int, default=40)
    ap.add_argument("--seed-base", type=int, required=True)
    ap.add_argument("--net", default="models/gen21-cand1.pt")
    ap.add_argument("--worlds", type=int, default=12,
                    help="consistent worlds per decision for the "
                         "preventable/irreducible split (0 = skip it)")
    ap.add_argument("--audit-from-trick", type=int, default=3,
                    help="per-decision auditing starts here; tricks 0-2 "
                         "are near-full-tree solves and dominate cost")
    ap.add_argument("--knowability-rate", type=float, default=0.35,
                    help="fraction of lossy decisions that get the "
                         "preventable/irreducible world sweep")
    ap.add_argument("--max-cands", type=int, default=99,
                    help="skip solving decisions with more options than "
                         "this (cost control; 1-option plays are free)")
    args = ap.parse_args()

    torch.set_num_threads(1)
    net = load_qnet(args.net)
    net.eval()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Resume by SEED, not by count: hands that produced no record (engine
    # redeals) leave gaps, so counting lines would re-run seeds we already
    # have and append duplicates — which would quietly bias the aggregate.
    seen = set()
    if out.exists():
        for line in open(out):
            line = line.strip()
            if line:
                seen.add(json.loads(line)["seed"])
    if seen:
        print(f"resuming {out.name}: {len(seen)} hands already recorded",
              flush=True)
    rng = random.Random(args.seed_base ^ 0xCE11)

    written = 0
    with open(out, "a") as f:
        h_i = 0
        seed = args.seed_base
        while written < args.hands:
            seed += 1
            if seed in seen:
                continue
            env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                               dealer=seed % 4)
            rows = []
            t_start = time.time()
            par0 = None
            while not env.done and not env.g.hand_history:
                seat, dtype, cands = env.decision()
                pick = model_choose(net, "cpu", env, seat, dtype, cands)
                # PAR: solve the deal once, the instant play begins. One
                # solve per hand — this is the cheap headline measurement.
                if (env.g.phase == PLAYING and par0 is None):
                    p0 = _position(env.g)
                    par0 = S.solve(p0["hands"], p0["trump"], p0["leader"],
                                   p0["gd"])
                if (env.g.phase == PLAYING and len(cands) > 1
                        and len(env.g.completed_tricks)
                        >= args.audit_from_trick
                        and len(cands) <= args.max_cands):
                    p = _position(env.g)
                    loss, _bc, n = decision_loss(p, seat, pick)
                    # knowability only where something was actually lost —
                    # it costs a solve per world, and a play that gave up
                    # nothing has nothing to explain
                    kn, tried = (None, 0)
                    if loss > 0 and rng.random() < args.knowability_rate:
                        kn, tried = knowability(env.g, seat, p, pick,
                                                args.worlds, rng)
                    rows.append({
                        "seat": seat, "team": team_of(seat),
                        "trick": p["tricks_done"],
                        "declarer": seat == env.g.bid_winner,
                        "decl_team": team_of(seat) == team_of(
                            env.g.bid_winner),
                        "loss": loss, "opts": len(cands),
                        "knowable": kn, "worlds": tried,
                    })
                env.apply(pick)
            if not env.g.hand_history or par0 is None:
                continue
            h_i += 1
            written += 1
            # Read the finished hand from hand_history: the engine has
            # already dealt the next one and cleared bid_winner/points.
            # entry = (n, bid_winner, bid, trump, score0, score1, went_set)
            _n, bw, bid, trump, hs0, hs1, went_set = env.g.hand_history[0]
            decl = team_of(bw)
            # defenders always score their raw points, so the declaring
            # side's take is the complement — true whether they made or set
            actual_decl = S.TOTAL_POINTS - (hs1 if decl == 0 else hs0)
            par_decl = par0 if decl == 0 else S.TOTAL_POINTS - par0
            rec = {"seed": seed, "trump": trump, "bid": bid,
                   "decl": decl, "bid_winner": bw,
                   "par_decl": par_decl, "actual_decl": actual_decl,
                   "shortfall": par_decl - actual_decl,
                   "made": int(not went_set),
                   "par_makes": int(par_decl >= bid),
                   "sec": round(time.time() - t_start, 1),
                   "rows": rows}
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(f"[{out.stem} h{h_i}] seed {seed} bid {bid} "
                  f"par {par_decl} actual {actual_decl} "
                  f"short {rec['shortfall']} "
                  f"{'MADE' if rec['made'] else 'SET'}"
                  f"{'' if rec['par_makes'] else ' (par sets too)'} "
                  f"audit {len(rows)} {rec['sec']}s", flush=True)


if __name__ == "__main__":
    main()
