'use client';

// A one-shot, CSS-only confetti burst in the four suit colors (plus gold).
// Absolutely fills its nearest positioned ancestor and ignores the pointer,
// so it can be dropped inside any card, modal, or full-screen overlay.
// Pieces fly outward from `origin` along per-piece CSS vars and fade —
// no timers, no cleanup, nothing to unmount.

import { useMemo } from 'react';

const COLORS = ['#dc2626', '#eab308', '#16a34a', '#0ea5e9', '#f8fafc', '#facc15'];

interface ConfettiBurstProps {
    count?: number;
    /** where the burst starts, as percentages of the container */
    origin?: { x: number; y: number };
    /** how far pieces travel, in px (roughly the container's radius) */
    spread?: number;
}

export default function ConfettiBurst({ count = 28, origin = { x: 50, y: 45 }, spread = 220 }: ConfettiBurstProps) {
    const pieces = useMemo(
        () =>
            Array.from({ length: count }, (_, i) => {
                const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
                const dist = spread * (0.45 + Math.random() * 0.55);
                return {
                    color: COLORS[i % COLORS.length],
                    dx: Math.cos(angle) * dist,
                    // launch upward-biased, gravity-ish landing
                    dy: Math.sin(angle) * dist * 0.8 + spread * 0.25,
                    rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
                    dur: 900 + Math.random() * 700,
                    delay: Math.random() * 120,
                    w: 6 + Math.random() * 5,
                    h: 10 + Math.random() * 6,
                };
            }),
        [count, spread],
    );

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {pieces.map((p, i) => (
                <span
                    key={i}
                    className="absolute rounded-[2px]"
                    style={{
                        left: `${origin.x}%`,
                        top: `${origin.y}%`,
                        width: p.w,
                        height: p.h,
                        backgroundColor: p.color,
                        ['--dx' as string]: `${p.dx}px`,
                        ['--dy' as string]: `${p.dy}px`,
                        ['--rot' as string]: `${p.rot}deg`,
                        animation: `confetti-fly ${p.dur}ms cubic-bezier(0.15, 0.8, 0.4, 1) ${p.delay}ms forwards`,
                        opacity: 0,
                    }}
                />
            ))}
        </div>
    );
}
