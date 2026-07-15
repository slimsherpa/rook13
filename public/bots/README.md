# Bot portraits (the camp roster)

Drop a square PNG here for each AI agent and it shows up automatically on
the badges and in the lobby. Until a file exists, the game falls back to the
persona emoji, so everything works without them.

Recommended: square (1:1), ~256×256 or larger, transparent or solid
background is fine (the avatar is clipped to a circle).

The camp ranks the agents weakest → strongest: Stomper (the rookie) up to
Cosmo (the grandmaster). Listed here strongest first:

| File               | Agent   | Brain  | Camp rank | Art |
|--------------------|---------|--------|-----------|-----|
| `cosmo.png`        | Cosmo   | gen16  | grandmaster (default) | BYU space cougar w/ glasses |
| `cougar.png`       | Cougar  | gen13  | #2        | tan cougar (purple bg) |
| `puma.png`         | Puma    | gen11  | #3        | black panther (blue bg) |
| `cub.png`          | Cub     | gen10  | #4        | lion cub (green bg) |
| `bobcat.png`       | Bobcat  | gen9   | #5        | bobcat / lynx (yellow bg) |
| `kitten.png`       | Kitten  | gen8   | #6        | tabby kitten (pink bg) |
| `stomper.png`      | Stomper | gen7   | rookie    | teal triceratops (pink bg) |

The persona ↔ brain mapping lives in `src/lib/game/types.ts` (`BOT_PERSONAS`);
it is cosmetic — the real strength ranking is the `AI·<gen>` chip on the badge.
