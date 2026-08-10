'use client';

// THE LABORATORY — human-vs-AlphaRook decision games (local-first).
// Every position is a real cached Gen25-RC1 game from the training
// corpus: no live computation. Human picks are saved locally and later
// replay-scored on the fleet against what RC1 actually did — the
// human-vs-bot scoreboard that decides where the next build goes.

import Link from 'next/link';
import { useRouter } from 'next/navigation';

const Game = ({ href, title, blurb, live }: {
    href: string; title: string; blurb: string; live: boolean;
}) => (
    <Link
        href={live ? href : '#'}
        className={`block rounded-xl border p-4 transition
            ${live
                ? 'border-sky-500/40 bg-navy-950/60 hover:border-sky-400 hover:bg-navy-950'
                : 'border-white/10 bg-navy-950/30 opacity-50 pointer-events-none'}`}
    >
        <div className="font-orbitron text-white text-base font-bold flex items-center gap-2">
            {title}
            {!live && <span className="text-[10px] font-sans text-white/40 border border-white/20 rounded-full px-2 py-0.5">coming soon</span>}
        </div>
        <div className="text-white/70 text-sm mt-1 leading-relaxed">{blurb}</div>
    </Link>
);

export default function LabPage() {
    const router = useRouter();
    return (
        <main className="min-h-screen bg-gradient-to-b from-navy-900 to-navy-950 px-4 py-8">
            <div className="max-w-xl mx-auto">
                <button onClick={() => router.push('/')} className="text-white/50 text-sm mb-6 hover:text-white">
                    ← Home
                </button>
                <h1 className="font-orbitron text-yellow-400 text-2xl font-bold mb-1">The Laboratory</h1>
                <p className="text-white/60 text-sm mb-8 leading-relaxed">
                    Real hands from Gen25-RC1&apos;s training games. You make the call,
                    then grade the bot&apos;s. Your picks get replayed by the fleet to
                    settle it: human or machine?
                </p>
                <div className="space-y-4">
                    <Game
                        href="/lab/widowmaker"
                        title="WidowMaker"
                        blurb="You bought the bid. Pick trump and bury four — then see what the bot buried, and grade it."
                        live
                    />
                    <Game
                        href="/lab/firstcard"
                        title="First Card Player"
                        blurb="The opening lead from all four seats — the biggest card of the hand. You lead; the bot takes it from there. 400 leads, 100 per seat."
                        live
                    />
                    <Game
                        href="/lab/lineplayer"
                        title="Line Player"
                        blurb="Partner bought it — you lead and play the WHOLE hand against the live bot. Prove the line. Skip dud hands freely."
                        live
                    />
                    <Game
                        href="/lab/bidbot"
                        title="BidBot"
                        blurb="What would you bid? Score, dealer, and the auction so far."
                        live={false}
                    />
                </div>
            </div>
        </main>
    );
}
