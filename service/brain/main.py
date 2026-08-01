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
_widow: dict = {"chooser": None, "tried": False}


def widow_chooser():
    """WidowBrain, if enabled. OFF unless the WIDOWBRAIN env var names a
    checkpoint (see the deploy-gate note at the widow branch): the v2
    model's edge did not transfer to gen21-play rollouts."""
    if not _widow["tried"]:
        _widow["tried"] = True
        path = os.environ.get("WIDOWBRAIN", "")
        if path and os.path.exists(path):
            from alpharook.widowbrain import WidowChooser
            _widow["chooser"] = WidowChooser(path)
    return _widow["chooser"]


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
    long (the client's local cover fires at 40s for godrook seats). Every
    play tries the exact solver in a daemon thread; if the deadline passes,
    the move falls back to the gen21 reflex — late-trick solves (where the
    crush happens) finish in well under a second. Bids/widow/trump ride the
    net, exactly like the measured god arms.

    Production telemetry (Aug 2026): ~91% of plays solve in <1.3s; the
    slow ~9% are early tricks that used to hit the old 12s cap. The driver
    posts a "still thinking" table bubble at 10s, so the budget can afford
    to be generous — people wait for a bot they can see working."""

    def __init__(self, net, budget_s: float = float(os.environ.get("GOD_BUDGET_S", "25"))):
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
    are never reported.

    Budgeting is BACK-TO-FRONT: late-trick solves cost milliseconds, so
    they all get done first (guaranteed endgame coverage), then whatever
    budget remains goes to the expensive early tricks, latest-first (the
    most solvable hard ones before the least). Total budget is sized so
    the verdict lands while the family is still reading the recap."""
    import threading
    import time as _time
    from rook import solver as S
    from rook.cards import CARD_POINTS, team_of

    PER_SOLVE_S = 3.5
    GLOBAL_BUDGET_S = 30.0
    PAR_SOLVE_S = 10.0
    LEAK_FLOOR = 10   # deltas this size feed the per-player leak totals
    CHEAP_FROM_TRICK = 5  # 5+ tricks done => ~20 cards left, solves are instant
    MIN_DELTA = 20        # below this, not worth the family's attention

    # ---- pass 1: replay, snapshotting every real decision in the hand ----
    g = Game(dealer=SEAT_IDX[req.dealer])
    hand_no = 1
    snaps: list[dict] = []
    par_bid = None
    par_winner = None
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
            if hand_no == req.hand:
                par_bid = g.high_bid
                par_winner = g.bid_winner
        elif t == "PLAY_CARD":
            seat = SEAT_IDX[a["seat"]]
            card = a["card"]
            if hand_no == req.hand and len(g.legal_cards(seat)) > 1:
                snaps.append(dict(
                    hands=[list(h) for h in g.hands], trump=g.trump,
                    leader=g.trick_leader,
                    gd=sum(CARD_POINTS[c] for c in g.go_down),
                    trick=tuple(g.trick_plays),
                    tricks_done=len(g.completed_tricks),
                    t0=g.tricks_won[0], banked0=g.points_taken[0],
                    seat=seat, card=card))
            g.play_card(seat, card)
        elif t == "LAYDOWN":
            # deterministic claim — nothing to audit
            laydown_fastforward(g, SEAT_IDX[a["seat"]])
        elif t == "NEXT_HAND":
            g.next_hand()
            hand_no += 1
        if hand_no > req.hand:
            break

    # ---- pass 2: solve cheap-first, then hard tricks latest-first ----
    def order_key(s):
        cheap = s["tricks_done"] >= CHEAP_FROM_TRICK
        return (0, s["tricks_done"]) if cheap else (1, -s["tricks_done"])
    snaps.sort(key=order_key)

    def solve_values(s):
        """play_values with a deadline; None on timeout."""
        out: list = []

        def run():
            try:
                out.append(S.play_values(
                    s["hands"], s["trump"], s["leader"], s["gd"],
                    t0_tricks=s["t0"], tricks_done=s["tricks_done"],
                    trick=s["trick"]))
            except Exception:
                pass
        th = threading.Thread(target=run, daemon=True)
        th.start()
        th.join(PER_SOLVE_S)
        return out[0] if out else None

    started = _time.time()
    found: list[dict] = []
    leaks: dict[str, int] = {}
    earliest: dict | None = None   # earliest-solved position, for par-from-k
    analyzed = skipped = 0
    for s in snaps:
        if _time.time() - started >= GLOBAL_BUDGET_S:
            skipped += 1
            continue
        vals = solve_values(s)
        if vals is None:
            skipped += 1
            continue
        analyzed += 1
        seat, card = s["seat"], s["card"]
        if team_of(seat) == 0:
            best = max(vals, key=lambda c: vals[c])
            delta = vals[best] - vals.get(card, vals[best])
            pos_v0 = vals[best]
        else:
            best = min(vals, key=lambda c: vals[c])
            delta = vals.get(card, vals[best]) - vals[best]
            pos_v0 = vals[best]
        if earliest is None or s["tricks_done"] < earliest["tricks_done"]:
            earliest = {"tricks_done": s["tricks_done"],
                        "v0": s["banked0"] + pos_v0}
        if delta >= LEAK_FLOOR:
            name = SEAT_NAME[seat]
            leaks[name] = leaks.get(name, 0) + int(delta)
        if delta >= MIN_DELTA and best != card:
            found.append({
                "trick": s["tricks_done"],
                "seat": SEAT_NAME[seat],
                "card": card,
                "better": best,
                "delta": int(delta),
            })

    # Par: what the DECLARER'S team takes at perfect play by everyone.
    # Exact from trick 1 when the solver makes the deadline; otherwise the
    # earliest solved position stands in ("par from trick k") — still
    # enough to say whether the contract was gone early.
    par = None
    par_from = None
    if par_winner is not None and snaps:
        # the opening lead's position = the true par point (snaps are
        # cheap-first sorted by now, so search, don't index)
        first = next((s for s in snaps
                      if s["tricks_done"] == 0 and not s["trick"]), None)
        exact = None
        if first is not None:
            out: list = []

            def run_par():
                try:
                    out.append(S.solve(
                        first["hands"], first["trump"], first["leader"],
                        first["gd"], t0_tricks=first["t0"],
                        tricks_done=0, trick=first["trick"]))
                except Exception:
                    pass
            th = threading.Thread(target=run_par, daemon=True)
            th.start()
            th.join(PAR_SOLVE_S)
            if out:
                exact = first["banked0"] + out[0]
        v0 = exact if exact is not None else (earliest["v0"] if earliest else None)
        if v0 is not None:
            par = int(v0 if team_of(par_winner) == 0 else 120 - v0)
            par_from = 0 if exact is not None else earliest["tricks_done"]

    # the two worst moments only — a recap, not a lecture
    found.sort(key=lambda b: -b["delta"])
    return {"hand": req.hand, "blunders": found[:2], "leaks": leaks,
            "par": par, "parFrom": par_from,
            "bid": par_bid,
            "bidWinner": SEAT_NAME[par_winner] if par_winner is not None else None,
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
    from alpharook.arena import model_choose

    def choose(d, c):
        if spec[0] == "reflex":
            return int(model_choose(spec[1], "cpu", env, seat, d, c))
        return int(spec[2].choose(env, seat, d, c))

    def collect_go_down():
        """4 sequential discard picks -> production's one SELECT_GODOWN."""
        picks = []
        for _ in range(4):
            _s, d2, c2 = env.decision()
            pick = choose(d2, c2)
            picks.append(pick)
            env.apply(pick)
        return {"action": {"type": "SELECT_GODOWN", "seat": sname,
                           "cards": picks}}

    # The lab env is trump-INTENT-first: at widow start it wants the trump
    # suit declared (privately, no engine transition), THEN the 4 discards
    # shaped around it. Production wants only the SELECT_GODOWN here.
    # Mapping D_TRUMP-at-widow straight to SELECT_TRUMP was the "Not
    # selecting trump now" stuck-loop bug.
    #
    # WIDOWBRAIN (gen24, 2026-08-01): when enabled via the WIDOWBRAIN env
    # var, the trained chooser makes the whole (go-down, trump) decision.
    # SHIPS DISABLED: +3.80pp make-rate under gen23 play, but the transfer
    # gate under gen21 play (what Cosmo actually plays) came back
    # +0.53 ± 1.24 — not significant. Enable only after a gen21/t0-gated
    # model passes. Deterministic on the 13-card set, so the trump phase
    # below recomputes the identical choice with no state between nudges.
    if dtype == D_TRUMP and g.phase == WIDOW:
        wc = widow_chooser()
        if wc is not None:
            d4, _t = wc.choose(list(g.hands[seat]), g.high_bid)
            return {"action": {"type": "SELECT_GODOWN", "seat": sname,
                               "cards": list(d4)}}
        env.apply(choose(dtype, cands))       # the private intent
        return collect_go_down()
    if dtype == D_DISCARD:
        return collect_go_down()

    if dtype == D_TRUMP:
        # THE 2-CARD-TRUMP BUG (found 2026-08-01, prod audit of 714 games):
        # asking the net for trump HERE — at the TRUMP phase, on the kept
        # nine — is a question it never saw in training (the lab always
        # auto-applies the widow-time intent), and its discards were shaped
        # around that intent. The stateless re-derivation disagreed with
        # the intent 12.2% of the time and picked a shorter-than-longest
        # suit 6.2% (production 'teacher': 9.5%, incl. gutted 2-card
        # suits). Fix: rebuild the 13-card widow state and re-ask the
        # EXACT intent question — deterministic, in-distribution, and
        # consistent with the discards it already made.
        wc = widow_chooser()
        if wc is not None:
            hand13 = list(g.hands[seat]) + list(g.go_down)
            _d4, t = wc.choose(hand13, g.high_bid)
            return {"action": {"type": "SELECT_TRUMP", "seat": sname,
                               "suit": int(t)}}
        g13 = g.clone()
        g13.hands[seat] = g13.hands[seat] + list(g13.go_down)
        g13.go_down = []
        g13.phase = WIDOW
        g13.turn = seat
        env13 = SelfPlayGame.__new__(SelfPlayGame)
        env13.g = g13
        env13.picks = []
        env13.trump_intent = None
        _s3, d3, c3 = env13.decision()
        assert d3 == D_TRUMP, "widow reconstruction should ask for intent"
        if spec[0] == "reflex":
            intent = int(model_choose(spec[1], "cpu", env13, seat,
                                      D_TRUMP, c3))
        else:
            intent = int(spec[2].choose(env13, seat, D_TRUMP, c3))
        return {"action": {"type": "SELECT_TRUMP", "seat": sname,
                           "suit": intent}}

    choice = choose(dtype, cands)
    if dtype == D_BID:
        return {"action": {"type": "BID", "seat": sname,
                           "bid": "pass" if choice == PASS else choice}}
    return {"action": {"type": "PLAY_CARD", "seat": sname, "card": choice}}


@app.get("/healthz")
def healthz():
    return {"ok": True, "styles": list(_agents.keys())}
