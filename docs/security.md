# Rook13 security posture

Written 2026-08-01, after an external review of the public repo. This is the
triage: what we fixed, what we deliberately accepted, and why. The honest
one-liner: **Rook13 is a family game built on trust — the goal of these
changes is to keep internet strangers out of the family's games, not to make
the game cheat-proof against a family member with dev tools.**

## Fixed (this branch)

### 1. Any signed-in user could rewrite any game → participants only
`firestore.rules` now restricts `games/{id}` updates to the host, the seated
players (`playerUids`), or someone seating themselves (their uid appears in
the incoming `playerUids` — open tables are joinable by design). Same
boundary on `games/{id}/actions` creates, with a typed escape hatch for
`SIT`/`LEAVE_SEAT` (at rule-evaluation time the joiner isn't in the
*committed* `playerUids` yet — `get()` in rules sees pre-transaction state).
Action-log docs are also shape-checked (`index/at/action/by` only).

Behavior change worth knowing: a **spectator can no longer fire the forfeit
clock** (`FORFEIT` is a game write). Seated players' clients run the same
clock, so this only matters if every seated human has closed their tab.

### 2. Trophy self-award → field allowlist on `users/{uid}`
Owner writes are now restricted to `displayName / photoURL / createdAt /
stats` via `diff().affectedKeys()`. `jayCupYears` is granted only from the
Firebase console (admin bypasses rules), so nobody can award themselves the
family cup from the browser console. Note the limit: `stats` itself is still
client-computed (see accepted risks).

### 3. Cloud Run service was publicly invokable with zero auth → Firebase ID tokens
`service/driver/index.ts` now verifies a `Bearer <Firebase ID token>` on
every `POST /nudge` and `/audit` (IAM stays `allUsers` — browsers can't mint
Google IAM tokens; the app layer is the boundary). Also added: 1 KB body
cap, and a per-user audit quota (12 fresh solves/hour) since one audit costs
about a minute of solver CPU. Clients attach the token via
`botServiceHeaders()` in `src/lib/botService.ts` (SDK-cached, no latency).

**Deploy order matters:** ship the service first, then hosting. In between,
old clients send no token → 401 → tables degrade to the local gen19 cover
(annoying, not broken) and audits fail. `ALLOW_ANON=1` on the service is the
rollback hatch if the pinch lasts. CORS now allows the `authorization`
header — old service + new client would die at preflight, another reason the
service goes first.

### 4. Invites were globally readable/spoofable → parties only
Invite reads are restricted to sender/recipient; creates enforce the doc id
scheme (`{gameId}_{toUid}`), sender identity, and an exact field allowlist.

### 5. Missing browser security headers
`firebase.json` hosting now sends `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy:
strict-origin-when-cross-origin`, and a minimal `Permissions-Policy`. A full
CSP was skipped deliberately: Next.js static export inlines scripts and the
app talks to Firebase/Google endpoints — a strict CSP is a project of its
own and the payoff is small for an auth-gated app.

**To take effect these need Riley's usual manual deploys:** rules
(`firebase deploy --only firestore:rules`), hosting (GitHub Action or
`firebase deploy --only hosting`), and the Cloud Run rebuild (see
`service/README.md`, no `--[no-]allow-unauthenticated` flags!).

## Accepted risks (deliberate, documented)

- **The client is the referee.** Move legality runs in `submitAction()` in
  the browser; bots run in players' browsers. A seated player with dev tools
  can still play illegal moves in their own game. Fixing this means a
  server-authoritative engine — a rewrite of the optimistic-sync
  architecture that makes the game feel instant. Not worth it for a family
  table; the action log means shenanigans leave a permanent audit trail.
- **All four hands live in the game doc.** Anyone in (or spectating) a game
  can read every hand from Firestore. This is load-bearing: the client bot
  runner, laydown validation (`isLaydown` reads all hands), and AlphaRook's
  determinization all need the full doc. Splitting hands server-side is the
  same rewrite as above. Family trust covers it.
- **Stats inflation.** `stats` is client-computed, so a determined family
  member can still pad their win count (they cannot touch `jayCupYears`).
  The ladder is bragging rights; the audit trail is `users/{uid}/history`.
- **Spectator surface.** Watchers/chat/blunders stay open to any signed-in
  user because spectating is a feature. Chat is length-capped and
  append-only.
- **Next.js 14.2.7.** Static export means most Next server CVEs
  (middleware bypass, server actions) don't apply. Upgrade when convenient,
  not urgent.

## If the game ever leaves the family

Revisit in this order: (1) server-authoritative actions behind the Cloud Run
service, (2) per-seat hand subdocuments with redacted spectator views,
(3) App Check on the service, (4) server-maintained stats.
