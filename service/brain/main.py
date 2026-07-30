"""The brain: stateless bot-decision service for Rook13.

POST /decide
  {"actions": [<LoggedAction.action>...], "dealer": "A1", "style": "gen23"}
-> {"action": {"type": "PLAY_CARD", "seat": "B1", "card": 27}, ...}

Replays the production action log through the parity-proven lab engine
(ml/rook), then asks the requested agent for the current decision. The
service holds no game state — every request carries the whole log. A
family game's log is a few hundred small actions; replay costs
milliseconds and statelessness makes Cloud Run scaling trivial.

Run locally:
  uvicorn service.brain.main:app --port 8081
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[2] / "ml"
sys.path.insert(0, str(ML))

from fastapi import FastAPI, HTTPException          # noqa: E402
from pydantic import BaseModel                      # noqa: E402

from rook.cards import PASS, suit_of, num_of        # noqa: E402
from rook.engine import (Game, BIDDING, WIDOW, TRUMP,        # noqa: E402
                         PLAYING)

SEAT_IDX = {"A1": 0, "B1": 1, "A2": 2, "B2": 3}
SEAT_NAME = {v: k for k, v in SEAT_IDX.items()}

app = FastAPI()
_agents: dict = {}


def get_agent(style: str):
    """Lazy singleton per style — models load once per instance."""
    if style in _agents:
        return _agents[style]
    os.chdir(ML)   # model paths in checkpoints are ml-relative
    from alpharook.model import load_qnet
    if style == "gen23":
        agent = ("reflex", load_qnet("models/gen23-cand1.pt"))
    elif style == "gen21":
        agent = ("reflex", load_qnet("models/gen21-cand1.pt"))
    elif style == "teacher":
        from alpharook.search import SearchAgent
        from alpharook.beliefs import BeliefOracle
        from alpharook.encoder import D_PLAY
        net = load_qnet("models/gen21-cand1.pt")
        agent = ("agent", net, SearchAgent(
            net, worlds=24, search_dtypes=frozenset({D_PLAY}),
            prior_weight=2.0, min_trick=0,
            belief=BeliefOracle("runs/gen15/best_duel.pt", temp=0.5)))
    elif style == "godrook":
        net = load_qnet("models/gen21-cand1.pt")
        agent = ("agent", net, TimeboxedGod(net))
    else:
        raise HTTPException(400, f"unknown server style: {style}")
    _agents[style] = agent
    return agent


class TimeboxedGod:
    """AlphaGodRook under a wall-clock budget. The gauntlet's god took
    minutes on opening-trick exact solves; a family table can't wait that
    long (the client's local cover fires at 20s). Every play tries the
    exact solver in a daemon thread; if the deadline passes, the move
    falls back to the gen21 reflex — late-trick solves (where the crush
    happens) finish in well under a second. Bids/widow/trump ride the net,
    exactly like the measured god arms."""

    def __init__(self, net, budget_s: float = 12.0):
        self.net = net
        self.budget = budget_s
        self.last_search = None

    def choose(self, env, seat, dtype, cands):
        import threading
        from alpharook.arena import model_choose
        from alpharook.encoder import D_PLAY
        from alpharook.god import position
        from rook import solver as S
        if dtype != D_PLAY or len(cands) <= 1:
            return model_choose(self.net, "cpu", env, seat, dtype, cands)
        p = position(env.g)          # snapshot in THIS thread, then solve
        out: list = []

        def run():
            try:
                card, _v = S.best_play(
                    p["hands"], p["trump"], p["leader"], p["gd"],
                    t0_tricks=p["t0_tricks"], tricks_done=p["tricks_done"],
                    trick=p["trick"])
                out.append(card)
            except Exception:
                pass
        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(self.budget)
        if out and out[0] in cands:
            return out[0]
        return model_choose(self.net, "cpu", env, seat, dtype, cands)


def laydown_fastforward(g: Game, claimant: int) -> None:
    """Mirror of engine.ts LAYDOWN: the claimant leads sortHand()[0]
    (strongest first: trump suit, then longest/most-powerful, number desc;
    suit groups in first-appearance order, stable ties) and everyone else
    follows with their lowest legal card (number, then suit index). Both
    engines keep hands in deal order, so first-appearance grouping agrees."""
    while g.phase == PLAYING:
        turn = g.turn
        if turn == claimant:
            hand = g.hands[turn]
            groups: dict[int, list[int]] = {}
            for c in hand:                       # first-appearance order
                groups.setdefault(suit_of(c), []).append(c)
            for cs in groups.values():
                cs.sort(key=num_of, reverse=True)
            def group_key(item):
                s, cs = item
                is_trump = 0 if (g.trump is not None and s == g.trump) else 1
                power = sum(num_of(c) for c in cs)
                return (is_trump, -len(cs), -power)
            ordered = sorted(groups.items(), key=group_key)  # stable
            card = ordered[0][1][0]
        else:
            card = min(g.legal_cards(turn),
                       key=lambda c: (num_of(c), suit_of(c)))
        g.play_card(turn, card)


def replay(dealer: str, actions: list[dict]) -> Game:
    g = Game(dealer=SEAT_IDX[dealer])
    for a in actions:
        t = a["type"]
        if t in ("DEAL", "ACK_REDEAL"):
            g.deal(a["deck"])
        elif t == "BID":
            g.bid(SEAT_IDX[a["seat"]],
                  PASS if a["bid"] == "pass" else a["bid"])
        elif t == "SELECT_GODOWN":
            g.select_go_down(SEAT_IDX[a["seat"]], a["cards"])
        elif t == "SELECT_TRUMP":
            g.select_trump(SEAT_IDX[a["seat"]], a["suit"])
        elif t == "PLAY_CARD":
            g.play_card(SEAT_IDX[a["seat"]], a["card"])
        elif t == "NEXT_HAND":
            g.next_hand()
        elif t == "LAYDOWN":
            laydown_fastforward(g, SEAT_IDX[a["seat"]])
        # SIT / LEAVE_SEAT / SET_BOT / OPEN_SEAT / START_GAME / SET_ASSIST:
        # lobby + UI actions; no engine effect
    return g


class DecideReq(BaseModel):
    dealer: str
    actions: list[dict]
    style: str


class AuditReq(BaseModel):
    dealer: str
    actions: list[dict]
    hand: int          # 1-based hand number to audit


@app.post("/audit")
def audit(req: AuditReq):
    """The blunder detector: replay the log and, for every real card play
    in the target hand, ask the exact double-dummy solver (AlphaGodRook's
    brain) what each legal card was worth IN THE TRUE WORLD. A blunder =
    points the acting team left on the table vs the best card. Decisions
    where every card scores the same (doomed anyway) score delta 0 and
    are never reported. Per-decision solves are timeboxed; a global
    budget keeps the request inside Cloud Run's timeout."""
    import threading
    import time as _time
    from rook import solver as S
    from rook.cards import CARD_POINTS, team_of

    PER_SOLVE_S = 4.0
    GLOBAL_BUDGET_S = 50.0
    MIN_DELTA = 20        # below this, not worth the family's attention

    g = Game(dealer=SEAT_IDX[req.dealer])
    hand_no = 1
    found: list[dict] = []
    analyzed = skipped = 0
    started = _time.time()

    def solve_values(pos_g):
        """play_values with a deadline; None on timeout."""
        hands = [list(h) for h in pos_g.hands]
        trump = pos_g.trump
        leader = pos_g.trick_leader
        gd = sum(CARD_POINTS[c] for c in pos_g.go_down)
        trick = tuple((s, c) for s, c in pos_g.trick_plays)
        tricks_done = len(pos_g.completed_tricks)
        t0 = pos_g.tricks_won[0]
        out: list = []

        def run():
            try:
                out.append(S.play_values(
                    hands, trump, leader, gd, t0_tricks=t0,
                    tricks_done=tricks_done, trick=trick))
            except Exception:
                pass
        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(PER_SOLVE_S)
        return out[0] if out else None

    for a in req.actions:
        t = a["type"]
        if t in ("DEAL", "ACK_REDEAL"):
            g.deal(a["deck"])
        elif t == "BID":
            g.bid(SEAT_IDX[a["seat"]],
                  PASS if a["bid"] == "pass" else a["bid"])
        elif t == "SELECT_GODOWN":
            g.select_go_down(SEAT_IDX[a["seat"]], a["cards"])
        elif t == "SELECT_TRUMP":
            g.select_trump(SEAT_IDX[a["seat"]], a["suit"])
        elif t == "PLAY_CARD":
            seat = SEAT_IDX[a["seat"]]
            card = a["card"]
            if hand_no == req.hand:
                legal = g.legal_cards(seat)
                if len(legal) > 1 and _time.time() - started < GLOBAL_BUDGET_S:
                    vals = solve_values(g)
                    if vals is None:
                        skipped += 1
                    else:
                        analyzed += 1
                        if team_of(seat) == 0:
                            best = max(vals, key=lambda c: vals[c])
                            delta = vals[best] - vals.get(card, vals[best])
                        else:
                            best = min(vals, key=lambda c: vals[c])
                            delta = vals.get(card, vals[best]) - vals[best]
                        if delta >= MIN_DELTA and best != card:
                            found.append({
                                "trick": len(g.completed_tricks),
                                "seat": SEAT_NAME[seat],
                                "card": card,
                                "better": best,
                                "delta": int(delta),
                            })
                elif len(legal) > 1:
                    skipped += 1
            g.play_card(seat, card)
        elif t == "LAYDOWN":
            # deterministic claim — nothing to audit
            laydown_fastforward(g, SEAT_IDX[a["seat"]])
        elif t == "NEXT_HAND":
            g.next_hand()
            hand_no += 1
        if hand_no > req.hand:
            break

    # the two worst moments only — a recap, not a lecture
    found.sort(key=lambda b: -b["delta"])
    return {"hand": req.hand, "blunders": found[:2],
            "analyzed": analyzed, "skipped": skipped}


@app.post("/decide")
def decide(req: DecideReq):
    g = replay(req.dealer, req.actions)
    if g.turn is None or g.phase not in (BIDDING, WIDOW, TRUMP, PLAYING):
        raise HTTPException(409, "no decision pending")
    seat = g.turn
    sname = SEAT_NAME[seat]

    # the env layer speaks decision-types; wrap the replayed engine
    from alpharook.env import SelfPlayGame
    from alpharook.encoder import D_BID, D_DISCARD, D_TRUMP, D_PLAY
    env = SelfPlayGame.__new__(SelfPlayGame)
    env.g = g
    env.picks = []
    env.trump_intent = None
    s2, dtype, cands = env.decision()
    assert s2 == seat, "env/turn disagreement"

    spec = get_agent(req.style)
    if spec[0] == "reflex":
        from alpharook.arena import model_choose
        choice = int(model_choose(spec[1], "cpu", env, seat, dtype, cands))
        picks = None
    else:
        _, net, agent = spec
        if dtype == D_DISCARD:
            # go-down arrives as 4 sequential picks in the lab env; the
            # production action wants all 4 at once
            picks = []
            for _ in range(4):
                s2, d2, cands = env.decision()
                c = int(agent.choose(env, seat, d2, cands))
                picks.append(c)
                env.apply(c)
            choice = None
        else:
            choice = int(agent.choose(env, seat, dtype, cands))
            picks = None

    if dtype == D_BID:
        return {"action": {"type": "BID", "seat": sname,
                           "bid": "pass" if choice == PASS else choice}}
    if dtype == D_TRUMP:
        return {"action": {"type": "SELECT_TRUMP", "seat": sname,
                           "suit": choice}}
    if dtype == D_DISCARD:
        if picks is None:       # reflex path: collect 4 picks the same way
            from alpharook.arena import model_choose
            picks = []
            for _ in range(4):
                s2, d2, cands = env.decision()
                c = int(model_choose(spec[1], "cpu", env, seat, d2, cands))
                picks.append(c)
                env.apply(c)
        return {"action": {"type": "SELECT_GODOWN", "seat": sname,
                           "cards": picks}}
    return {"action": {"type": "PLAY_CARD", "seat": sname, "card": choice}}


@app.get("/healthz")
def healthz():
    return {"ok": True, "styles": list(_agents.keys())}
