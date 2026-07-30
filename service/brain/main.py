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

from rook.cards import PASS                         # noqa: E402
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
        from alpharook.god import GodAgent
        net = load_qnet("models/gen21-cand1.pt")
        agent = ("agent", net, GodAgent(net))
    else:
        raise HTTPException(400, f"unknown server style: {style}")
    _agents[style] = agent
    return agent


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
            raise HTTPException(501, "laydown replay not modeled yet — "
                                     "leave this game to client bots")
        # SIT / LEAVE_SEAT / SET_BOT / OPEN_SEAT / START_GAME / SET_ASSIST:
        # lobby + UI actions; no engine effect
    return g


class DecideReq(BaseModel):
    dealer: str
    actions: list[dict]
    style: str


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
