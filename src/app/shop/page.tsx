'use client';

// The Rook13 shop: one legendary t-shirt. Checkout is a plain link into
// the Troll Factory Shopify store; Printful prints and ships.

import { useState } from 'react';
import Link from 'next/link';
import RookBird from '@/components/ui/RookBird';
import {
    SHIRT_COLORS, SHIRT_SIZES, SIZE_PRICES, ShirtSize, checkoutUrl,
} from '@/lib/shop/catalog';

export default function ShopPage() {
    const [colorIdx, setColorIdx] = useState(0);
    const [size, setSize] = useState<ShirtSize>('L');

    const color = SHIRT_COLORS[colorIdx];
    const variantId = color.variants[size];
    const price = SIZE_PRICES[size];

    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-5">
                {/* header */}
                <div className="flex items-center justify-between mb-6">
                    <Link href="/" className="flex items-center gap-2 text-white/70 hover:text-white transition">
                        <span className="material-symbols-outlined">arrow_back</span>
                        <span className="font-orbitron text-xs uppercase tracking-widest">Back</span>
                    </Link>
                    <h1 className="font-orbitron text-2xl font-black text-white flex items-center gap-2">
                        <RookBird className="w-8 h-8 text-white/90" />
                        SHOP
                    </h1>
                </div>

                {/* product card */}
                <div className="rounded-2xl bg-navy-950/50 border border-white/15 overflow-hidden">
                    <div className="bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={color.image}
                            alt={`Rook t-shirt — ${color.label}`}
                            className="w-full aspect-square object-cover"
                        />
                    </div>

                    <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-white font-orbitron font-bold text-lg leading-tight">
                                    The Rook Tee
                                </h2>
                                <p className="text-white/50 text-xs mt-1">
                                    Unisex tri-blend · vintage-soft, pre-shrunk
                                </p>
                            </div>
                            <div className="text-yellow-400 font-orbitron font-bold text-xl whitespace-nowrap">
                                ${price}
                            </div>
                        </div>

                        {/* color picker */}
                        <div className="mt-4">
                            <div className="text-white/70 font-orbitron text-[10px] uppercase tracking-widest mb-2">
                                Color · <span className="text-white">{color.label}</span>
                            </div>
                            <div className="flex flex-wrap gap-2.5">
                                {SHIRT_COLORS.map((c, i) => (
                                    <button
                                        key={c.name}
                                        onClick={() => {
                                            setColorIdx(i);
                                            // a size the new color doesn't come in falls back to L
                                            if (!c.variants[size]) setSize('L');
                                        }}
                                        title={c.label}
                                        aria-label={c.label}
                                        className={`w-9 h-9 rounded-full border-2 transition ${
                                            i === colorIdx
                                                ? 'border-sky-400 scale-110 shadow-[0_0_8px_rgba(56,189,248,0.6)]'
                                                : 'border-white/25 hover:border-white/60'
                                        }`}
                                        style={{ backgroundColor: c.swatch }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* size picker */}
                        <div className="mt-4">
                            <div className="text-white/70 font-orbitron text-[10px] uppercase tracking-widest mb-2">
                                Size
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {SHIRT_SIZES.map((s) => {
                                    const offered = Boolean(color.variants[s]);
                                    return (
                                        <button
                                            key={s}
                                            onClick={() => offered && setSize(s)}
                                            disabled={!offered}
                                            className={`px-3.5 py-2 rounded-lg font-orbitron text-xs font-bold border transition ${
                                                s === size
                                                    ? 'bg-sky-600 border-sky-400 text-white'
                                                    : offered
                                                        ? 'bg-navy-950/60 border-white/20 text-white/80 hover:border-sky-400'
                                                        : 'bg-navy-950/30 border-white/10 text-white/25 cursor-not-allowed line-through'
                                            }`}
                                        >
                                            {s}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* buy — a plain link straight into Shopify checkout */}
                        <a
                            href={variantId ? checkoutUrl(variantId) : undefined}
                            className="mt-5 w-full py-4 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-navy-950 font-orbitron font-bold text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition"
                        >
                            <span className="material-symbols-outlined">shopping_bag</span>
                            BUY — ${price}
                        </a>

                        <p className="text-white/40 text-[11px] text-center mt-3">
                            Secure checkout by Troll Factory, our merch partner.
                            Printed on demand and shipped by Printful.
                        </p>
                    </div>
                </div>

                {/* lore */}
                <p className="text-white/50 text-xs text-center mt-6 px-4">
                    50% polyester, 25% cotton, 25% rayon — soft enough to lose a
                    500-point game in and still feel like a champion.
                </p>
            </div>
        </div>
    );
}
