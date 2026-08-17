import { describe, expect, it } from 'vitest';
import { RANK_TIERS, ladderRank } from './rank';
import { GM_SKILL_FLOOR, SkillGame, boardSkills, grindOf, replaySkill } from './skill';
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
        expect(replaySkill([])).toEqual({ rating: 1000, skill: 1000, ranked: 0, provisional: true });
        const three = series(3, (i) => game({ vs: 'gen13', won: true, margin: 120, at: i }));
        expect(replaySkill(three).provisional).toBe(false);
    });

    it('a few placement wins over mid bots reaches Gold', () => {
        const r = replaySkill(series(6, (i) =>
            game({ vs: 'gen13', won: true, margin: 150, at: i })));
        expect(r.rating).toBeGreaterThanOrEqual(tierMin('gold'));
    });

    it('law 1: farming easy bots caps SKILL below Diamond and can never mint GM', () => {
        const r = replaySkill(series(300, (i) =>
            game({ vs: 'gen9', won: true, margin: 500, at: i })));
        expect(r.skill).toBeGreaterThanOrEqual(tierMin('gold'));
        expect(r.skill).toBeLessThan(tierMin('diamond'));      // outrank taper
        expect(r.skill).toBeLessThan(GM_SKILL_FLOOR);
        expect(ladderRank(r).tier.key).not.toBe('grandmaster'); // GM skill gate
    });

    it('law 1: the same record vs Cosmo is worth far more than vs Stomper', () => {
        const vsCosmo = replaySkill(series(60, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 150 : -80, at: i })));
        const vsStomper = replaySkill(series(60, (i) =>
            game({ vs: 'gen9', won: i % 2 === 0, margin: i % 2 === 0 ? 150 : -80, at: i })));
        expect(vsCosmo.skill).toBeGreaterThan(vsStomper.skill + 150);
    });

    it('law 2 (the Nate clause): 48% wins vs Cosmo with close losses reaches Master+', () => {
        // 150 games, 48% win rate, wins by ~150, losses by only ~80
        const r = replaySkill(series(150, (i) => {
            const won = (i * 12) % 25 < 12;   // 12/25 = 48%
            return game({ vs: 'gen26', won, margin: won ? 150 : -80, at: i });
        }));
        expect(r.skill).toBeGreaterThanOrEqual(tierMin('master'));
    });

    it('law 2: margins split winners at the same win rate', () => {
        const bigWins = replaySkill(series(80, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 300 : -40, at: i })));
        const bigLosses = replaySkill(series(80, (i) =>
            game({ vs: 'gen26', won: i % 2 === 0, margin: i % 2 === 0 ? 40 : -300, at: i })));
        expect(bigWins.skill).toBeGreaterThan(bigLosses.skill + 80);
    });

    it('law 3: trainer and counter games earn reduced rating', () => {
        const raw = series(30, (i) => game({ vs: 'gen16', won: true, margin: 150, at: i }));
        const clean = replaySkill(raw);
        const trained = replaySkill(raw.map((g) => ({ ...g, assistUsed: true })));
        const counted = replaySkill(raw.map((g) => ({ ...g, counterUsed: true })));
        expect(trained.skill).toBeLessThan(counted.skill);
        expect(counted.skill).toBeLessThan(clean.skill);
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

    it('law 4: shown rating banks grind, capped at 200 games', () => {
        expect(grindOf(0)).toBe(0);
        expect(grindOf(100)).toBe(150);
        expect(grindOf(200)).toBe(300);
        expect(grindOf(500)).toBe(300);
        const r = replaySkill(series(50, (i) =>
            game({ vs: 'gen16', won: i % 2 === 0, margin: i % 2 === 0 ? 150 : -150, at: i })));
        expect(r.rating).toBe(r.skill + grindOf(50));
    });

    it('gates: a 29-game heater wears Platinum, not Master (the Sydney rule)', () => {
        const hot = replaySkill(series(29, (i) =>
            game({ vs: 'gen26', won: i % 7 !== 0, margin: 250, at: i })));
        expect(hot.rating).toBeGreaterThanOrEqual(tierMin('master'));
        const rank = ladderRank(hot);
        expect(rank.tier.key).toBe('platinum');
        expect(rank.locked?.tier.key).toMatch(/master|grandmaster/);
        // …and the badge follows once the sample proves out
        const proven = replaySkill(series(80, (i) =>
            game({ vs: 'gen26', won: i % 7 !== 0, margin: 250, at: i })));
        expect(ladderRank(proven).tier.key).toMatch(/master|grandmaster/);
    });

    it('humans price at their board skill, not as peers', () => {
        const nateUid = 'nate';
        // 40 losses to a table with one human opponent (Nate)
        const vsNate: SkillGame[] = series(40, (i) => {
            const g = game({ vs: 'gen16', won: false, margin: -120, at: i });
            g.seats!.B1 = human(nateUid);
            return g;
        });
        const asPeer = replaySkill(vsNate);                       // Nate = my rating
        const asKnown = replaySkill(vsNate, { [nateUid]: 1700 }); // Nate = 1700
        // losing to a known 1700 costs less than losing to a "peer"
        expect(asKnown.skill).toBeGreaterThan(asPeer.skill);
    });

    it('boardSkills iterates the whole family to a stable fixed point', () => {
        const a = 'aaa', b = 'bbb';
        // A beats strong bots; B mostly loses to A across 30 games
        const aGames = series(30, (i) =>
            game({ vs: 'gen26', won: i % 3 !== 0, margin: 200, at: i }));
        const bGames: SkillGame[] = series(30, (i) => {
            const g = game({ vs: 'gen13', won: i % 4 === 0, margin: i % 4 === 0 ? 100 : -150, at: i });
            g.seats!.B1 = human(a);
            return g;
        });
        const board = boardSkills({ [a]: aGames, [b]: bGames });
        expect(board[a].skill).toBeGreaterThan(1400);
        // B's losses were partly to a strong human — B rates above the
        // peer-assumption replay of the same games
        expect(board[b].skill).toBeGreaterThan(replaySkill(bGames).skill);
    });
});
