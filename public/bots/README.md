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
| `07-Cosmo.jpg`     | Cosmo   | gen16  | grandmaster (default) | BYU space cougar w/ glasses |
| `06-Cougar.jpg`    | Cougar  | gen13  | #2        | tan cougar (purple bg) |
| `05-Puma.jpg`      | Puma    | gen11  | #3        | black panther (blue bg) |
| `04-Cub.jpg`       | Cub     | gen10  | #4        | lion cub (green bg) |
| `03-Bobcat.jpg`    | Bobcat  | gen9   | #5        | bobcat / lynx (yellow bg) |
| `02-Kitten.jpg`    | Kitten  | gen8   | #6        | tabby kitten (pink bg) |
| `01-Stomper.jpg`   | Stomper | gen7   | rookie    | teal triceratops (pink bg) |

The exact filename each agent looks for is set in `BOT_PERSONAS`
(`src/lib/game/types.ts`); change it there if you rename a file.

The persona ↔ brain mapping lives in `src/lib/game/types.ts` (`BOT_PERSONAS`);
it is cosmetic — the real strength ranking is the `AI·<gen>` chip on the badge.
