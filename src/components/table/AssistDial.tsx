'use client';

// The trainer's dial: a little clock that fills to show how likely the latest
// brain would be to make this pick. Empty ring = the model wouldn't; a full
// sweep = the model's clear choice. Rendered next to bids, trump suits,
// go-down candidates and playable cards when AI-assistant mode is on.

interface AssistDialProps {
    /** 0..1 pick-likelihood, or undefined while the model is still thinking */
    p: number | undefined;
    size?: number;
    className?: string;
}

export default function AssistDial({ p, size = 20, className = '' }: AssistDialProps) {
    if (p === undefined) return null;
    const pct = Math.round(p * 100);
    // fill clockwise from 12 o'clock; a hint of ring even at 0 so the dial
    // is always visible as "the model considered this"
    const deg = Math.max(0, Math.min(360, p * 360));
    const strong = p >= 0.5;
    const fill = strong ? '#facc15' /* yellow-400 */ : '#38bdf8' /* sky-400 */;
    return (
        <span
            className={`inline-flex items-center justify-center rounded-full shrink-0 ${className}`}
            style={{
                width: size,
                height: size,
                background: `conic-gradient(${fill} ${deg}deg, rgba(255,255,255,0.14) ${deg}deg)`,
            }}
            title={`AI would pick this ${pct}% of the time`}
        >
            <span
                className="rounded-full bg-black/80 flex items-center justify-center"
                style={{ width: size - 6, height: size - 6 }}
            >
                <span className="font-orbitron text-white leading-none" style={{ fontSize: size * 0.34 }}>
                    {pct}
                </span>
            </span>
        </span>
    );
}
