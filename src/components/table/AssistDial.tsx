'use client';

// The trainer's dial: a little clock that fills to show how likely the latest
// brain would be to make this pick. Solid hot-pink sweep on black, filling
// clockwise from 12 o'clock — empty means the model wouldn't, a full circle
// means it's the model's clear choice. Hot pink is the AI assistant's signature
// color, used nowhere else, so a coached table reads at a glance. Hover for the
// exact percentage. Shown beside bids, trump suits, go-down candidates and
// playable cards when AI-assistant mode is on.

// The AI assistant's signature color — reserved for the trainer, nothing else.
export const ASSIST_PINK = '#ff2d95';

interface AssistDialProps {
    /** 0..1 pick-likelihood, or undefined while the model is still thinking */
    p: number | undefined;
    size?: number;
    className?: string;
}

export default function AssistDial({ p, size = 18, className = '' }: AssistDialProps) {
    if (p === undefined) return null;
    const pct = Math.round(p * 100);
    // fill clockwise from 12 o'clock; solid pink pie on black, no ring, no label
    const deg = Math.max(0, Math.min(360, p * 360));
    return (
        <span
            className={`inline-block rounded-full shrink-0 ${className}`}
            style={{
                width: size,
                height: size,
                background: `conic-gradient(${ASSIST_PINK} ${deg}deg, #000 ${deg}deg)`,
                boxShadow: `0 0 0 1px ${ASSIST_PINK}66`,
            }}
            title={`AI would pick this ${pct}% of the time`}
        />
    );
}
