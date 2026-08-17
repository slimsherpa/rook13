'use client';

// Shared Beat the Bot UI, in the real table's visual language: the
// trump-colored table background, the ActionDock control strip, the
// assist-pink dials above cards, and the announce-pop reveal. The Lab
// pages were the prototype; these match the game the family plays.

import { Grade } from '@/lib/minigames/scoring';
import { LAYER_NEED, LAYER_TIERS, TOP_LAYER } from '@/lib/minigames/difficulty';
import { MiniGameProgress } from '@/lib/minigames/types';
import { ASSIST_PINK } from '@/components/table/AssistDial';

/** 3x3 table from the hero seat's chair: partner top, left/right sides.
 *  Highlight one relative seat (mark = its role glyph). */
export function TableMap({ mark, markRel, dealerRel }: {
    mark: string; markRel: number; dealerRel?: number;
}) {
    const cell = (rel: number, label: string) => (
        <div className={`w-11 h-7 rounded border text-[10px] flex items-center justify-center gap-1
            ${markRel === rel ? 'border-yellow-300 text-yellow-200 font-bold bg-black/20' : 'border-white/25 text-white/60'}`}>
            {label}
            <span>{[
                dealerRel === rel ? 'D' : '',
                markRel === rel ? mark : '',
            ].filter(Boolean).join(' ')}</span>
        </div>
    );
    return (
        <div className="grid grid-cols-3 gap-1 w-fit" title={`${mark} = the marked seat · D = dealer`}>
            <div />{cell(2, '')}<div />
            {cell(1, '')}<div className="w-11 h-7" />{cell(3, '')}
            <div />{cell(0, 'ME')}<div />
        </div>
    );
}

/** Solid assist-pink dot — the trainer's signature color, used to mark
 *  the bot's own picks on the reveal. */
export function BotDot({ size = 16 }: { size?: number }) {
    return (
        <span
            className="inline-block rounded-full shrink-0"
            style={{
                width: size, height: size, background: ASSIST_PINK,
                boxShadow: `0 0 0 2px rgba(15,36,71,0.9)`,
            }}
        />
    );
}

/** The bot's value for a card, drawn exactly like the trainer's
 *  AssistDial (solid assist-pink sweep on black) — the family already
 *  reads this glyph as "how much the AI likes it". */
export function ValueDial({ frac, value, size = 22 }: {
    frac: number; value?: number; size?: number;
}) {
    const deg = Math.max(0, Math.min(360, frac * 360));
    return (
        <span
            className="inline-block rounded-full shrink-0"
            style={{
                width: size, height: size,
                background: `conic-gradient(${ASSIST_PINK} ${deg}deg, #000 ${deg}deg)`,
                boxShadow: `0 0 0 1px ${ASSIST_PINK}66`,
            }}
            title={value !== undefined ? `searched value ${value}` : undefined}
        />
    );
}

const TIER_STYLE: Record<Grade['tier'], { ring: string; text: string; icon: string }> = {
    perfect: { ring: 'ring-green-400/80', text: 'text-green-300', icon: 'verified' },
    close: { ring: 'ring-lime-400/70', text: 'text-lime-300', icon: 'thumb_up' },
    ok: { ring: 'ring-yellow-400/70', text: 'text-yellow-300', icon: 'lightbulb' },
    miss: { ring: 'ring-pink-400/70', text: 'text-pink-300', icon: 'school' },
};

/** The reveal: pops like the table's announcements, then holds with the
 *  next-situation button so the pace never breaks. */
export function RevealCard({ grade, k, onNext, nextLabel, children }: {
    grade: Grade; k: number; onNext: () => void; nextLabel: string;
    children?: React.ReactNode;
}) {
    const s = TIER_STYLE[grade.tier];
    return (
        <div className={`animate-announce-pop rounded-2xl bg-navy-950/90 ring-2 ${s.ring} shadow-2xl p-4 max-w-sm mx-auto`}>
            <div className={`font-orbitron text-sm font-bold ${s.text} flex items-center gap-2`}>
                <span className="material-symbols-outlined text-2xl">{s.icon}</span>
                {grade.headline}
            </div>
            {grade.detail && (
                <div className="text-white/80 text-sm mt-1.5">{grade.detail}</div>
            )}
            {children}
            <button
                onClick={onNext}
                className="w-full mt-3 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm font-bold active:scale-95 transition flex items-center justify-center gap-2"
            >
                {nextLabel}
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </button>
            <div className="text-white/35 text-[10px] mt-2 text-center">
                Gen26 + DayDream · {k} imagined worlds
            </div>
        </div>
    );
}

/** Running score strip: difficulty layer + climb, streak, situations done. */
export function ScoreStrip({ p, total }: { p: MiniGameProgress; total: number }) {
    const layer = p.layer ?? 0;
    const tier = LAYER_TIERS[layer];
    const hits = (p.recent ?? []).reduce((a, b) => a + b, 0);
    const next = layer < TOP_LAYER ? LAYER_TIERS[layer + 1] : null;
    return (
        <div className="flex items-center gap-2 text-[11px] font-orbitron">
            <span className={`px-2 py-1 rounded-lg bg-black/25 border border-white/20 font-bold ${tier.color}`}>
                {tier.emoji} {tier.name}
            </span>
            {next && (
                <span
                    className="px-2 py-1 rounded-lg bg-black/25 border border-white/20 text-white/70"
                    title={`${LAYER_NEED} perfect-or-close in your last 14 unlocks ${next.name}`}
                >
                    {Math.min(hits, LAYER_NEED)}/{LAYER_NEED} to {next.emoji}
                </span>
            )}
            <span className={`px-2 py-1 rounded-lg border ${
                p.streak >= 3
                    ? 'bg-orange-500/20 border-orange-400/60 text-orange-200'
                    : 'bg-black/25 border-white/20 text-white/70'}`}>
                <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">local_fire_department</span>
                {p.streak} streak
            </span>
            <span className="px-2 py-1 rounded-lg bg-black/25 border border-white/20 text-white/70 ml-auto">
                {p.done.length}/{total}
            </span>
        </div>
    );
}

/** The layer-up celebration, shown inside the RevealCard on the answer
 *  that clinched a promotion. */
export function LayerUpBanner({ layer }: { layer: number }) {
    const tier = LAYER_TIERS[Math.min(layer, TOP_LAYER)];
    return (
        <div className={`mt-2.5 rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-3 py-2 text-center font-orbitron text-sm font-bold ${tier.color}`}>
            <span className="material-symbols-outlined text-base align-middle mr-1 text-yellow-300">trending_up</span>
            LAYER UP — welcome to {tier.emoji} {tier.name}!
            <div className="text-white/60 text-[10px] font-normal mt-0.5">
                {layer >= TOP_LAYER
                    ? 'The summit. These are the hairline calls.'
                    : 'The situations get trickier from here.'}
            </div>
        </div>
    );
}

export function AllDoneCard({ title }: { title: string }) {
    return (
        <div className="rounded-2xl border border-yellow-500/40 bg-navy-950/70 p-6 text-center mt-6 max-w-sm mx-auto">
            <span className="material-symbols-outlined text-yellow-400 text-5xl">military_tech</span>
            <div className="font-orbitron text-white font-bold text-lg mt-2">{title}</div>
            <div className="text-white/70 text-sm mt-2 leading-relaxed">
                You did ALL the training we have! Tell Riley you want more —
                the bot can mill a fresh batch overnight.
            </div>
        </div>
    );
}
