# Granting the JAY CUP trophy

The JAY CUP is the crown jewel of the Trophy Case: a real-world Gardner
Family Rook Tournament title, tied to a real player's account. The app
renders it in two places, both already live:

- **Profile** (`/profile?uid=…`) — the walnut-and-silver JayCupTrophy card,
  above everything else in the Trophy Case, listing the championship years.
- **Leaderboard** (`/players`) — a gold trophy icon next to the winner's
  name, with the years in its tooltip.

The app **never writes** this field. `firestore.rules` allowlists what a
player may write to their own `users/{uid}` doc, and `jayCupYears` is
deliberately not on the list — so nobody can award themselves the family
trophy from a browser console. Grants happen only through the Firebase
console (or Admin SDK), which bypasses rules.

## How to grant (Firebase console, ~1 minute)

1. Open [console.firebase.google.com](https://console.firebase.google.com)
   → the Rook13 project → **Firestore Database**.
2. Open the **`users`** collection and find the winner's doc. Doc ids are
   auth uids; the `displayName` field inside each doc tells you who's who.
   (If two family members share a name, cross-check the photo URL, or find
   the exact uid under **Authentication → Users** by their email.)
3. On that doc, **Add field**:
   - Field name: `jayCupYears`
   - Type: `array`
   - Elements: type `number`, one per championship year — e.g. `2025`, `2026`.
4. Save. The trophy appears the next time their profile or the leaderboard
   loads — no deploy, no restart.

To add a later title to an existing champion, edit the array and append the
new year. To revoke (heaven forbid), delete the field.

## Why it's safe to edit by hand

Every client write to `users/{uid}` is merge-based (`setDoc(..., {merge})` /
field-diff rules), so sign-ins and stat updates never clobber a
console-granted field. The update rule checks
`diff().affectedKeys().hasOnly([...])` — the granted `jayCupYears` riding
along unchanged doesn't trip it.
