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

## Architecture (SHIPPED 2026-07-30, nudge-based)

Two layers in one Cloud Run container:

1. **driver/ (Node/TS)** — the only writer. NOT a standing Firestore
   listener (that needs `--no-cpu-throttling` ≈ $46/mo): instead clients
   POST `/nudge {gameId}` whenever they see a SERVER_STYLES bot's turn
   (`src/lib/botService.ts`, fire-and-forget from useGame). The driver
   re-reads the truth from Firestore, asks the brain for the decision,
   applies it with the app's own `applyAction` (the SAME engine.ts the
   clients run — zero doc-shape parity risk), and writes via the same
   `expectedActionCount` transaction as `submitAction`. Request-based
   billing + 1 warm min-instance ≈ $10/mo, ~$0.001/game of think time.
   Client bot runners skip SERVER_STYLES thinking turns but still handle
   DEAL/ACK_REDEAL shuffles, and cover with local gen19 if the service
   stays silent 20s (useGame.ts) — an outage degrades, never hangs.
   `GET /status` reports driver + brain health (`/healthz` is intercepted
   by Google's frontend on run.app — don't use it).

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

## Deploy / operate

Deployed 2026-07-30: service `rook13-bots`, region us-central1, project
rook13-01, image `us-central1-docker.pkg.dev/rook13-01/rook13/bots`.

- URL: https://rook13-bots-3ytxfwifyq-uc.a.run.app (also in
  `src/lib/botService.ts`; override with NEXT_PUBLIC_BOT_SERVICE_URL)
- Rebuild + redeploy (repo root):
  `gcloud builds submit --config service/cloudbuild.yaml .` then
  `gcloud run deploy rook13-bots --image us-central1-docker.pkg.dev/rook13-01/rook13/bots:latest --region us-central1 --min-instances 1 --max-instances 3 --memory 1Gi --cpu 1 --concurrency 8 --timeout 60`
- ONE-TIME (Riley, permission-gated for Claude): make it publicly
  invokable so family clients can nudge it —
  `gcloud run services add-iam-policy-binding rook13-bots --region us-central1 --project rook13-01 --member=allUsers --role=roles/run.invoker`
  Until then nudges 404 and every table quietly plays the local gen19
  cover instead of the teacher.

## v1 notes

- LAYDOWN is now replayed exactly (laydown_fastforward in brain/main.py
  mirrors engine.ts's deterministic expansion).
- godrook runs under a 12s wall-clock budget per play (TimeboxedGod):
  exact solver when it finishes, gen21 reflex when it doesn't — early
  tricks on hard hands fall back, the late-trick crush is always exact.
- `SET_ASSIST`, seating actions etc. are replay no-ops for the brain.
- Card int encoding is shared (TS trace encoding == python ints 0..39);
  the driver asserts this against fixtures at startup.
