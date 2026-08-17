import { describe, expect, it } from 'vitest';
import { RANK_TIERS } from './rank';
import { SkillGame, replaySkill } from './skill';
import { BotStyle, Seat, SeatInfo } from './types';

const tierMin = (key: string) => RANK_TIERS.find((t) => t.key === key)!.min;

const bot = (style: BotStyle): SeatInfo => ({ kind: 'bot', name: 'Bot', botStyle: style });
const human = (uid: string): SeatInfo => ({ kind: 'human', uid, name: uid });

/** A finished game from seat A1 vs a table of one bot style. */
const game = (opts: {
    vs: BotStyle; won: boolean; margin: number; at: number;
    assist?: boolean; counter?: boolean; botThink?: boolean;
}): SkillGame => {
    const seats: Record<Seat, SeatInfo> = {
        A1: human('me'), A2: bot(opts.vs), B1: bot(opts.vs), B2: bot(opts.vs),
    };
    return {
        seat: 'A1', seats,
        scores: { A: 300 + opts.margin, B: 300 } as Record<'A' | 'B', number>,
        won: opts.won, finishedAt: opts.at,
        botThink: opts.botThink,
        assistUsed: opts.assist, counterUsed: opts.counter,
    };
};

const series = (
    n: number, make: (i: number) => SkillGame,
): SkillGame[] => Array.from({ length: n }, (_, i) => make(i));

describe('replaySkill — the three laws of the ladder', () => {
    it('starts unranked at 1000 and leaves placements after 3 games', () => {
        expect(replaySkill([])).toEqual({ rating: 1000, ranked: 0, provisional: true });
        const three = series(3, (i) => game({ vs: 'gen13', won: true, margin: 120, at: i }));
        expect(replaySkill(three).provisional).toBe(false);
    });

    it('a few placement wins over mid bots reaches Gold', () => {
        const r = replaySkill(series(6, (i) =>
            game({ vs: 'gen13', won: true, margin: 150, at: i })));
        expect(r.rating).toBeGreaterThanOrEqual(tierMin('gold'));
    });

    it('law 1: farming easy bots hard-stops around Gold/low-Platinum', () => {
        const r = replaySkill(series(300, (i) =>
            game({ vs: 'gen9', won: true, margin: 350, at: i })));
        expect(r.rating).toBeGreaterThanOrEqual(tierMin('gold'));
        expect(r.rating).toBeLessThan(tierMin('diamond'));
    });

    it('law 1: the same record vs Cosmo is worth far more than vs Stomper', () => {
        const vsCosmo = replaySkill(series(60, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 150 : -80, at: i })));
        const vsStomper = replaySkill(series(60, (i) =>
            game({ vs: 'gen9', won: i % 2 === 0, margin: i % 2 === 0 ? 150 : -80, at: i })));
        expect(vsCosmo.rating).toBeGreaterThan(vsStomper.rating + 150);
    });

    it('law 2 (the Nate clause): 48% wins vs Cosmo with close losses reaches Master+', () => {
        // 150 games, 48% win rate, wins by ~150, losses by only ~80
        const r = replaySkill(series(150, (i) => {
            const won = (i * 12) % 25 < 12;   // 12/25 = 48%
            return game({ vs: 'gen26', won, margin: won ? 150 : -80, at: i });
        }));
        expect(r.rating).toBeGreaterThanOrEqual(tierMin('master'));
    });

    it('law 2: margins split winners at the same win rate', () => {
        const bigWins = replaySkill(series(80, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 300 : -40, at: i })));
        const bigLosses = replaySkill(series(80, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 40 : -300, at: i })));
        expect(bigWins.rating).toBeGreaterThan(bigLosses.rating + 100);
    });

    it('law 3: trainer and counter games earn reduced rating', () => {
        const raw = series(30, (i) => game({ vs: 'gen16', won: true, margin: 150, at: i }));
        const clean = replaySkill(raw);
        const trained = replaySkill(raw.map((g) => ({ ...g, assistUsed: true })));
        const counted = replaySkill(raw.map((g) => ({ ...g, counterUsed: true })));
        expect(trained.rating).toBeLessThan(counted.rating);
        expect(counted.rating).toBeLessThan(clean.rating);
    });

    it('DayDream tables rate above bare gen26', () => {
        const bare = replaySkill(series(40, (i) =>
            game({ vs: 'gen26', won: true, margin: 200, at: i })));
        const dreaming = replaySkill(series(40, (i) =>
            game({ vs: 'gen26', won: true, margin: 200, at: i, botThink: true })));
        expect(dreaming.rating).toBeGreaterThan(bare.rating);
    });

    it('losses always count in full — assists never soften the fall', () => {
        const losses = series(20, (i) => game({ vs: 'gen9', won: false, margin: -300, at: i }));
        const clean = replaySkill(losses);
        const trained = replaySkill(losses.map((g) => ({ ...g, assistUsed: true })));
        expect(trained.rating).toBe(clean.rating);
    });

    it('replays in finishedAt order regardless of input order', () => {
        const games = series(20, (i) =>
            game({ vs: 'gen16', won: i % 2 === 0, margin: i % 2 === 0 ? 200 : -100, at: i }));
        const shuffled = [...games].reverse();
        expect(replaySkill(shuffled).rating).toBe(replaySkill(games).rating);
    });

    it('tolerates legacy docs with no seats or scores', () => {
        const r = replaySkill(series(10, (i) => ({
            seat: 'A1' as Seat, won: i % 2 === 0, finishedAt: i,
        })));
        expect(Number.isFinite(r.rating)).toBe(true);
        expect(r.ranked).toBe(10);
    });
});
