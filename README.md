# Rook13

The family Rook variant, online — play with your people (or bots) from any phone.
Live at [rook13.com](https://rook13.com).

Rook13 uses only cards 5–14 in four suits; 5s are worth 5, and both 10s **and 13s**
are worth 10. Two teams of two bid, name trump, and race to +500 (or collapse to −250).
Full rules: [Rook13 Game Rules.md](./Rook13%20Game%20Rules.md).

## What's here (v2)

- **Live multiplayer** — create a table, share the 4-letter code or link, play from
  any browser. Empty seats are filled by bots.
- **Durable games** — all state lives in Firestore. Close your phone mid-hand and
  rejoin exactly where you were. Anyone signed in can open a game link and spectate.
- **The rules engine** ([src/lib/game/](src/lib/game/)) is pure TypeScript, unit-tested with
  full simulated games, including the celebrated all-6-7-8-9 misdeal.
- **Every play is logged** to `games/{id}/actions` — games can be perfectly
  reconstructed by replaying the log.
- **Profiles & stats** — wins, bids made, times set, legendary misdeals witnessed.

## Stack

Next.js 14 (static export) · Tailwind · Firebase Auth (Google) · Cloud Firestore.
No servers: clients validate every move through the shared engine inside Firestore
transactions, and bot turns are driven by the connected players' clients (host first,
others as fallback — exactly-once via optimistic concurrency).

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine test suite
npm run build      # static export to out/
```

Visit `/dev` for a local, no-login sandbox game against bots (great for UI work).

## Deploy

Pushing to `main` builds and deploys hosting via GitHub Actions.

**One-time setup** (and whenever `firestore.rules` changes):

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore   # rules + indexes
```

Firestore (Native mode) must be enabled in the
[Firebase console](https://console.firebase.google.com/project/rook13-01/firestore)
before first use.
