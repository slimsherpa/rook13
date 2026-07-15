# Bot portraits (the camp roster)

Drop a square PNG here for each AI agent and it shows up automatically on
the badges and in the lobby. Until a file exists, the game falls back to the
persona emoji, so everything works without them.

Recommended: square (1:1), ~256×256 or larger, transparent or solid
background is fine (the avatar is clipped to a circle).

| File               | Agent   | Brain  | Attached art |
|--------------------|---------|--------|--------------|
| `stomper.png`      | Stomper | gen16  | teal triceratops (pink bg) |
| `kitten.png`       | Kitten  | gen13  | tabby kitten (pink bg) |
| `bobcat.png`       | Bobcat  | gen11  | bobcat / lynx (yellow bg) |
| `cub.png`          | Cub     | gen10  | lion cub (green bg) |
| `puma.png`         | Puma    | gen9   | black panther (blue bg) |
| `cougar.png`       | Cougar  | gen8   | — needs art — |
| `cosmo.png`        | Cosmo   | gen7   | — needs art — |

The persona ↔ brain mapping lives in `src/lib/game/types.ts` (`BOT_PERSONAS`);
it is cosmetic — the real strength ranking is the `AI·<gen>` chip on the badge.
