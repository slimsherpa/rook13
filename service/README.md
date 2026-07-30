# Rook13 Bot Service — server-side brains on Cloud Run

Every bot brain, served from one small container — so shipping a new
generation never requires a TypeScript port again, and heavyweight brains
(the t0 teacher, AlphaGodRook) become playable on phones.

## Why server-side

Today (mapped 2026-07-30): bots run in **every seated client's browser** —
the host computes first, other clients are 2.5s fallbacks, and the
`actionCount` transaction in `submitAction` lets exactly one write win.
That design caps production bots at what a phone can compute in ~1s, which
is why production tops out at K8 search and why the teacher (K24 from the
opening lead, 78.5% vs gen21) has never been shippable.

The unlock discovered in the architecture map: `games/{id}` holds the FULL
authoritative state (all four hands — hiding is a UI concern), and the
action log replays deterministically (decks ride inside DEAL payloads).
A server process can reconstruct exact state with zero new plumbing —
and the Python lab engine is already golden-trace parity-proven against
the TS engine.

## Architecture

Two layers in one Cloud Run container:

1. **driver/ (Node/TS)** — the only writer. Firestore listener (admin
   SDK) over active games; when `game.turn` is a bot seat whose
   `botStyle` is in `SERVER_STYLES`, it asks the brain for a decision,
   applies it with the app's own `applyAction` (the SAME engine.ts the
   clients run — zero doc-shape parity risk), and writes via the same
   `expectedActionCount` transaction as `submitAction`. Client bot
   runners skip SERVER_STYLES seats (see `src/lib/game/types.ts`), and
   the transaction makes server/client coexistence safe regardless.

2. **brain/ (Python, FastAPI, localhost only)** — stateless decision
   oracle. POST /decide with the game's action log + seat + style; it
   replays the log through the parity-proven `ml/rook` engine, runs the
   requested agent, and returns a production-shaped Action:
   - `gen23`    — reflex, models/gen23-cand1.pt (encoder v4)
   - `gen21`    — reflex, models/gen21-cand1.pt
   - `teacher`  — gen21 + gen15 belief(0.5) + K24 PIMC from trick 0
   - `godrook`  — SECRET UNLOCK: exact-solver omniscient card play
                  (bids via gen21) — the humbling machine

## Cost & latency (measured, not guessed)

- teacher ≈ 3 core-seconds/hand → ~40 core-s per family game →
  **~$0.001/game** on Cloud Run. Reflex styles: ~free.
- Latency: reflex <100ms; teacher ~0.3–0.5s per thinking move.
- godrook: exact trick-0 solves are minutes-per-hand today — v1 gates the
  solver to later tricks with omniscient play before the gate under a
  time budget (see ml/alpharook/god.py notes; calibration duels will pin
  the config).

## Deploy prerequisites (Riley)

1. `gcloud auth login` + `gcloud config set project rook13-<id>` (one
   time; Claude can't complete browser auth).
2. Enable APIs: Cloud Run, Artifact Registry, (Eventarc if we later move
   off the listener).  `gcloud services enable run.googleapis.com
   artifactregistry.googleapis.com`
3. A service account with Firestore access (default compute SA works;
   admin SDK bypasses security rules — no rules change needed).
4. `gcloud run deploy rook13-bots --source service/ --min-instances 1`
   (min 1 keeps the listener warm ≈ $8–14/mo for the smallest instance;
   scale-to-zero variant possible later via Eventarc triggers).

## Known gaps (v1)

- Games containing a LAYDOWN action: the Python replayer doesn't model
  laydown yet — brain returns 501 and the driver leaves those games to
  client bots (rare; browser fallback still works for classic styles).
- `SET_ASSIST`, seating actions etc. are replay no-ops for the brain.
- Card int encoding is shared (TS trace encoding == python ints 0..39);
  the driver asserts this against fixtures at startup.
