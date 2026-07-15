'use client';

// A bot's face: its camp-persona portrait (public/bots/<name>.png) with the
// persona emoji as an always-there fallback — so a seat looks intentional
// whether or not the art has been dropped in yet. A missing/failed image
// quietly reveals the emoji underneath.

import { useState } from 'react';
import { BotStyle, personaFor } from '@/lib/game/types';

export default function BotAvatar({ style, size = 40, className = '' }: {
    style: BotStyle | undefined;
    size?: number;
    className?: string;
}) {
    const persona = personaFor(style);
    const [failed, setFailed] = useState(false);
    const showImg = persona.img && !failed;
    return (
        <span
            className={`relative inline-flex items-center justify-center overflow-hidden ${className}`}
            style={{ width: size, height: size }}
        >
            <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>{persona.emoji}</span>
            {showImg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={persona.img}
                    alt={persona.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={() => setFailed(true)}
                />
            )}
        </span>
    );
}
