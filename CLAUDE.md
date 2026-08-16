# Rook13 — working notes for Claude (and future Riley)

Family Rook game: Next.js 14 (App Router, static export) + Firebase
(project `rook13-01`: Hosting, Firestore, Auth) + a Cloud Run bot
service (`service/`) + the AlphaRook ML shop (`ml/`, Python).

## Git workflow

Work on a feature branch, merge to `main` when done (fast-forward is
fine), and **Riley pushes from GitHub Desktop** — Claude never pushes.
Delete feature branches after merge; the history lives on main.

## Deploying to production

There are three deployable pieces. Order matters only when a change
spans them: **service → hosting → rules**.

### 1. Hosting (the app itself) — two ways

- **Push to main**: the GitHub Action deploys hosting automatically on
  every push to `main`. This is the normal path for code changes.
  ⚠️ Consequence: whatever is committed on main is what ships — never
  push main while it's missing work that's already live (deploy from a
  branch ⇒ merge that branch to main before the next push).
- **Local one-liner** (used for mini-game bank refreshes, works for any
  hosting deploy):

  ```bash
  npm run deploy:bank
  ```

  That's `next build && npx firebase-tools deploy --only hosting` — it
  ships whatever is in the working tree, including the latest
  `public/minigames/*.json`. The firebase CLI on this Mac is already
  authenticated for `rook13-01`.

### 2. Firestore rules

```bash
npx firebase-tools deploy --only firestore:rules
```

Needed whenever `firestore.rules` changes. Additive rule changes are
safe to ship ahead of the app.

### 3. The bot service (Cloud Run)

Deployed via local `gcloud` (see `service/`); rarely changes. Deploy it
BEFORE hosting when a change spans both.

### Local-dev gotchas (hard-won)

- **One dev server at a time.** Two `next dev` processes share `.next`
  and corrupt each other (stale module graphs, phantom import errors,
  404s on real routes).
- **After any `next build` / `deploy:bank`, clear `.next` before
  restarting the dev server**: `rm -rf .next`. A dev server on top of a
  production build cache flakes (random 404s, full reloads).

## Beat the Bot mini-games (the corpus)

Situations live in `public/minigames/{godown,lead}_items.json` and ship
with hosting. They are milled offline by Gen26+DayDream at K=200:

```bash
# status
tail -3 ml/runs/minigames/mill_weekend.log

# stop
pkill -f alpharook.minigame_mill

# resume / extend (item id == seed, so growing never breaks progress)
cd ml && nohup ~/torch-env/bin/python -m alpharook.minigame_mill \
  --append --n 100000 --k 200 --workers 10 \
  --out-godown ../public/minigames/godown_items.json \
  --out-lead   ../public/minigames/lead_items.json \
  > runs/minigames/mill_weekend.log 2>&1 &
```

The mill checkpoints the banks every ~8 items (atomic write), needs the
laptop awake (`caffeinate -is`), and runs ~40-50 items/hour on 10
workers. **The growth loop is just:** let it mill, then
`npm run deploy:bank` whenever you want the new situations live, and
occasionally `git add public/minigames && git commit` a snapshot so
main doesn't drift too far behind prod. Player progress lives in
Firestore (`users/{uid}/minigames/{game}`) keyed by item id = mill
seed, so bank growth never invalidates anyone.

## Where things are

- Game engine + types: `src/lib/game/` (TS) · parity twin `ml/rook/` (Py)
- AlphaRook browser agent: `src/lib/alpharook/` · brains `ml/alpharook/`
- Card color palettes (cosmetic, device-local): `src/lib/game/palettes.ts`
  — suit NAMES are display-only; the engine always speaks
  Red/Yellow/Black/Green
- Mini-games UI: `src/app/minigames/` · lib `src/lib/minigames/`
- Device-local settings bus: `src/lib/settings.ts` (localStorage + one
  window event; every setting hook subscribes to it)
- Firestore rules: `firestore.rules` (user-owned docs pattern is
  documented inline)
