'use client';

// Shared Beat the Bot UI: the mini table map, the graded feedback
// banner, the score strip, and the "out of training" end card. Kept
// deliberately close to the table's visual vocabulary — same navy
// surfaces, orbitron headings, suit colors, blue-you / pink-bot rings
// as the AI assist and the Laboratory.

import { Grade } from '@/lib/minigames/scoring';
import { MiniGameProgress } from '@/lib/minigames/types';
import { agreementPct } from '@/lib/minigames/scoring';

export const SUIT_BG = ['bg-red-600', 'bg-yellow-500', 'bg-gray-900 border border-gray-500', 'bg-green-600'];

/** 3x3 table from the hero seat's chair: partner top, left/right sides.
 *  Highlight one relative seat (X = the marked role). */
export function TableMap({ mark, markRel, dealerRel }: {
    mark: string; markRel: number; dealerRel?: number;
}) {
    const cell = (rel: number, label: string) => (
        <div className={`w-11 h-7 rounded border text-[10px] flex items-center justify-center gap-1
            ${markRel === rel ? 'border-yellow-400 text-yellow-300 font-bold' : 'border-white/20 text-white/50'}`}>
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

const TIER_STYLE: Record<Grade['tier'], { border: string; text: string; icon: string }> = {
    perfect: { border: 'border-green-400/60', text: 'text-green-300', icon: 'verified' },
    close: { border: 'border-lime-400/50', text: 'text-lime-300', icon: 'thumb_up' },
    ok: { border: 'border-yellow-400/50', text: 'text-yellow-300', icon: 'lightbulb' },
    miss: { border: 'border-pink-400/50', text: 'text-pink-300', icon: 'school' },
};

export function FeedbackBanner({ grade, k }: { grade: Grade; k: number }) {
    const s = TIER_STYLE[grade.tier];
    return (
        <div className={`rounded-xl border ${s.border} bg-navy-950/60 p-4`}>
            <div className={`font-orbitron text-sm font-bold ${s.text} flex items-center gap-2`}>
                <span className="material-symbols-outlined text-xl">{s.icon}</span>
                {grade.headline}
            </div>
            {grade.detail && (
                <div className="text-white/70 text-sm mt-1.5">{grade.detail}</div>
            )}
            <div className="text-white/35 text-[10px] mt-2">
                Gen26 + DayDream · {k} imagined worlds per decision
            </div>
        </div>
    );
}

/** Running score strip: agreement %, streak, situations done. */
export function ScoreStrip({ p, total }: { p: MiniGameProgress; total: number }) {
    return (
        <div className="flex items-center gap-2 text-[11px] font-orbitron">
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/15 text-white/80">
                {agreementPct(p)}% with the bot
            </span>
            <span className={`px-2 py-1 rounded-lg border ${
                p.streak >= 3
                    ? 'bg-orange-500/15 border-orange-400/50 text-orange-300'
                    : 'bg-white/5 border-white/15 text-white/60'}`}>
                <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">local_fire_department</span>
                {p.streak} streak
            </span>
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/15 text-white/60 ml-auto">
                {p.done.length}/{total}
            </span>
        </div>
    );
}

export function AllDoneCard({ title }: { title: string }) {
    return (
        <div className="rounded-2xl border border-yellow-500/40 bg-gradient-to-b from-yellow-500/10 to-transparent p-6 text-center mt-6">
            <span className="material-symbols-outlined text-yellow-400 text-5xl">military_tech</span>
            <div className="font-orbitron text-white font-bold text-lg mt-2">{title}</div>
            <div className="text-white/70 text-sm mt-2 leading-relaxed">
                You did ALL the training we have! Tell Riley you want more —
                the bot can mill a fresh batch overnight.
            </div>
        </div>
    );
}
