"""Line Player sidecar — live bot seats for the Lab's play-it-out game.

Tiny local HTTP service (port 8124). Riley plays the LEADER's seat on
partner-bought hands from the corpus; the other three chairs run the
frozen production core, thinking for real between his cards. Completed
lines are banked to runs/lab/line_plays.jsonl paired with what the
recorded bot line scored on the same deal — the continuation-included
vision corpus, straight from the man himself.

    ~/torch-env/bin/python -m alpharook.lineserve   # blocks; ctrl-c stops

Endpoints (JSON):
  POST /next  {grader}         -> new hand state (skips banked/skipped ids)
  POST /skip  {id}             -> mark hand uninteresting, get nothing back
  POST /play  {card}           -> apply Riley's card, run bot seats until
                                  his turn or hand end; returns the plays
                                  made, trick state, and final result
"""

from __future__ import annotations

import glob
import json
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch

from rook.cards import team_of
from .anytime import AnytimeRookAgent
from .beliefs import BeliefOracle
from .duel import deck_stream
from .encoder import D_PLAY
from .env import SelfPlayGame
from .model import load_qnet
from .search import _Sim

OUT = "runs/lab/line_plays.jsonl"
SKIP = "runs/lab/line_skips.json"

print("loading organs…", flush=True)
NET = load_qnet("models/gen21-cand1.pt")
NET.eval()
BELIEF = BeliefOracle("models/gen15.pt", temp=0.5)
CORE = AnytimeRookAgent(NET, BELIEF, seed=4242)
print("organs ready", flush=True)


def corpus_positions():
    """Partner-bought lead positions, deterministic order."""
    rng = random.Random(515)
    recs = []
    for p in sorted(glob.glob("runs/belief/soak_box*_acts.jsonl")):
        for line in open(p):
            r = json.loads(line)
            if r.get("flip", 0) == 0:
                recs.append(r)
    rng.shuffle(recs)
    return recs


RECS = corpus_positions()


def load_done():
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            done.add(json.loads(line)["posId"])
    if os.path.exists(SKIP):
        done |= set(json.load(open(SKIP)))
    return done


def find_position(done):
    """Next partner-lead position not yet played/skipped.
    posId = f"{seed}:{hand}"."""
    for rec in RECS:
        env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                          dealer=rec["seed"] % 4,
                          win_score=rec.get("win", 500),
                          lose_score=rec.get("lose", -250))
        try:
            for (seat, dtype, action, *_r) in rec["d"]:
                e_seat, e_dtype, cands = env.decision()
                if e_seat != seat or e_dtype != dtype:
                    break
                g = env.g
                if (dtype == D_PLAY and not g.completed_tricks
                        and not g.trick_plays and len(cands) > 1):
                    if ((g.bid_winner - seat) % 4 == 2
                            and f"{rec['seed']}:{g.hand_number}" not in done):
                        return rec, g.hand_number, seat, env
                    break
                env.apply(action)
        except Exception:
            continue
    return None, None, None, None


def recorded_outcome(rec, hand_no, seat):
    env = SelfPlayGame(seed=rec["seed"], deck_fn=deck_stream(rec["seed"]),
                      dealer=rec["seed"] % 4,
                      win_score=rec.get("win", 500),
                      lose_score=rec.get("lose", -250))
    for (s0, dt, action, *_r) in rec["d"]:
        e_seat, e_dtype, cands = env.decision()
        env.apply(action)
        g = env.g
        for h in g.hand_history:
            if h[0] == hand_no:
                return int(h[4] if seat % 2 == 0 else h[5]), int(not h[6])
    return None, None


STATE: dict = {}


def start_hand(grader):
    done = load_done()
    rec, hand_no, seat, env = find_position(done)
    if rec is None:
        return {"error": "no more partner-lead hands"}
    g = env.g
    rec_pts, rec_made = recorded_outcome(rec, hand_no, seat)
    sim = _Sim(g, [], None)
    STATE.clear()
    STATE.update(dict(rec=rec, hand=hand_no, seat=seat, sim=sim,
                      grader=grader, plays=[], rec_pts=rec_pts,
                      rec_made=rec_made))
    return dict(posId=f"{rec['seed']}:{hand_no}",
                seat=seat, trump=int(g.trump), bid=int(g.high_bid),
                buyer=int(g.bid_winner),
                scores=[int(g.scores[seat % 2]),
                        int(g.scores[1 - seat % 2])],
                cards=sorted(int(c) for c in g.hands[seat]),
                recPts=rec_pts)


def advance_bots():
    """Run core seats until it's Riley's turn or the hand ends.
    Returns list of plays made [(seat, card)] and whether awaiting him."""
    sim = STATE["sim"]
    made = []
    with torch.no_grad():
        while not sim.hand_over:
            s, dt, cs = sim.decision()
            if dt == D_PLAY and s == STATE["seat"]:
                return made, True
            pick = cs[0] if len(cs) == 1 else CORE.choose(sim, s, dt, cs)
            sim.apply(pick)
            if dt == D_PLAY:
                made.append([int(s), int(pick)])
    return made, False


def hand_result():
    sim = STATE["sim"]
    h = sim.g.hand_history[-1]
    seat = STATE["seat"]
    my_pts = int(h[4] if seat % 2 == 0 else h[5])
    made = int(not h[6])
    row = dict(game="line", posId=f"{STATE['rec']['seed']}:{STATE['hand']}",
               seed=STATE["rec"]["seed"], hand=STATE["hand"], seat=seat,
               grader=STATE.get("grader") or "anon",
               line=STATE["plays"], myPts=my_pts, made=made,
               recPts=STATE["rec_pts"], recMade=STATE["rec_made"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "a") as f:
        f.write(json.dumps(row) + "\n")
    return dict(over=True, myPts=my_pts, made=made,
                recPts=STATE["rec_pts"], recMade=STATE["rec_made"])


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json({})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/next":
            self._json(start_hand(req.get("grader", "anon")))
        elif self.path == "/skip":
            done = []
            if os.path.exists(SKIP):
                done = json.load(open(SKIP))
            if req.get("id") and req["id"] not in done:
                done.append(req["id"])
                os.makedirs(os.path.dirname(SKIP), exist_ok=True)
                json.dump(done, open(SKIP, "w"))
            self._json({"ok": True})
        elif self.path == "/play":
            sim = STATE.get("sim")
            if sim is None:
                self._json({"error": "no hand in progress"}, 400)
                return
            card = int(req["card"])
            s, dt, cs = sim.decision()
            if dt != D_PLAY or s != STATE["seat"] or card not in cs:
                self._json({"error": "illegal"}, 400)
                return
            sim.apply(card)
            STATE["plays"].append(card)
            made, waiting = advance_bots()
            g = sim.g
            last = g.completed_tricks[-1] if g.completed_tricks else None
            resp = dict(botPlays=made,
                        trick=[[int(a), int(b)] for a, b in g.trick_plays],
                        tricksDone=len(g.completed_tricks),
                        lastTrick=dict(
                            plays=[[int(a), int(b)] for a, b in last[1]],
                            winner=int(last[2]), points=int(last[3]))
                        if last else None,
                        myCards=sorted(int(c) for c in g.hands[STATE["seat"]]),
                        over=False)
            if not waiting and sim.hand_over:
                resp.update(hand_result())
            self._json(resp)
        else:
            self._json({"error": "unknown"}, 404)


if __name__ == "__main__":
    print("lineserve on :8124", flush=True)
    HTTPServer(("127.0.0.1", 8124), H).serve_forever()
