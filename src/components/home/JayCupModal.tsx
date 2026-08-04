'use client';

// The Jay Cup — the Gardner family Rook tournament trophy, named for
// Jay Adamson, who won the inaugural cup in 2008. Styled after the real
// thing: a silver bowl on a walnut base with black engraved plaques.

import { useRouter } from 'next/navigation';
import RookBird from '@/components/ui/RookBird';

interface Champions {
    year: number;
    names: [string, string];
}

const CHAMPIONS: Champions[] = [
    { year: 2008, names: ['Jay Adamson', 'Ken Adamson'] },
    { year: 2010, names: ['Rob Gardner', 'David Gardner'] },
    { year: 2012, names: ['Rich Gardner', 'Spencer Gardner'] },
    { year: 2014, names: ['Gil Gardner', 'Matt Gardner'] },
    { year: 2016, names: ['Reed Gardner', 'Ken Adamson'] },
    { year: 2018, names: ['Norm Gardner', 'Darrell Gardner'] },
    { year: 2022, names: ['Carson Gardner', 'Mike Weaver'] },
    { year: 2024, names: ['Carson Gardner', 'Mike Weaver'] },
    { year: 2026, names: ['Brandon Chambers', 'JD Gardner'] },
];

// Champions who've signed up for Rook13 — their engraved name links to
// their Trophy Case. Add a line here as each one joins.
const CHAMPION_UIDS: Record<string, string> = {
    'Rob Gardner': '5G8lHHPCwKRdljhpH9dq3b4f86C3',
    'David Gardner': 'uBN9sFYEloTScP3aXztRRuPO5dI2',   // DavidK Gardner in-app
    'Spencer Gardner': 'aGIIxsrn1heiGvPovDLHpL1fd8G3',
    'Matt Gardner': 'YWzXvDSkVgbDTsuTUGGQXFikfev2',
    'Reed Gardner': 'nl6RegNDDxgrf2zNhHM2TXwTdOA3',
    'Darrell Gardner': 'BiJd3Q8QAqgbLkhGEVLStme0H023',
    'Carson Gardner': 'bNEh5J3V6MXHCOfHCkl9hJDmT8G3',
};

// Jay at the Rook table, across the decades (public/jay/), in Riley's order.
const JAY_PHOTOS = ['jay-06', 'jay-05', 'jay-03', 'jay-02', 'jay-07', 'jay-04', 'jay-01'];

export default function JayCupModal({ onClose }: { onClose: () => void }) {
    const router = useRouter();

    // an engraved name: signed-up champions click through to their profile
    const champName = (name: string) => {
        const uid = CHAMPION_UIDS[name];
        if (!uid) {
            return (
                <div key={name} className="text-gray-100 text-[11px] font-serif font-semibold leading-tight">
                    {name}
                </div>
            );
        }
        return (
            <button
                key={name}
                onClick={() => router.push(`/profile?uid=${uid}`)}
                className="block w-full text-gray-100 text-[11px] font-serif font-semibold leading-tight underline decoration-dotted decoration-gray-500 underline-offset-2 hover:text-yellow-200"
            >
                {name}
            </button>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="relative w-full max-w-sm max-h-[90dvh] rounded-2xl bg-navy-950 border border-white/15 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* floating close — the photo gallery runs long, nobody
                    should have to scroll past Jay to leave */}
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute top-2.5 right-2.5 z-10 w-8 h-8 rounded-full bg-black/60 border border-white/25 text-white/80 hover:text-white hover:border-white/50 flex items-center justify-center"
                >
                    <span className="material-symbols-outlined text-lg">close</span>
                </button>
                <div className="max-h-[90dvh] overflow-y-auto custom-scrollbar">
                {/* the bowl */}
                <div className="pt-6 pb-2 text-center bg-gradient-to-b from-sky-900/50 to-transparent">
                    <span
                        className="material-symbols-outlined text-7xl"
                        style={{
                            background: 'linear-gradient(160deg, #f8fafc 10%, #94a3b8 45%, #e2e8f0 60%, #64748b 90%)',
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                            color: 'transparent',
                        }}
                    >
                        trophy
                    </span>
                </div>

                {/* the front plaque */}
                <div className="mx-6 rounded-lg bg-gradient-to-b from-[#3b2314] to-[#241209] border border-[#5a3a22] p-1 shadow-lg">
                    <div className="rounded-md bg-black/85 border border-gray-500/40 px-4 py-4 text-center">
                        <div className="font-serif text-gray-100 text-2xl font-bold tracking-[0.15em]">JAY CUP</div>
                        <div className="text-gray-300 text-[11px] mt-1 tracking-wide">Gardner Family Rook Tournament</div>
                        <div className="font-serif text-gray-100 text-sm font-bold tracking-[0.3em] mt-1.5">CHAMPIONS</div>
                        <RookBird className="w-12 h-12 mx-auto mt-2 text-gray-300/90" />
                    </div>
                </div>

                {/* in memoriam */}
                <p className="px-7 pt-4 text-center text-white/70 text-xs leading-relaxed">
                    Named in memory of <span className="text-yellow-300/90 font-semibold">Jay Adamson</span>,
                    who won the inaugural cup in 2008. The family has played for his trophy ever since.
                </p>

                {/* champion plaques */}
                <div className="px-6 py-4">
                    <div className="rounded-lg bg-gradient-to-b from-[#3b2314] to-[#241209] border border-[#5a3a22] p-3 grid grid-cols-2 gap-2.5 shadow-lg">
                        {CHAMPIONS.map(({ year, names }) => (
                            <div key={year} className="rounded bg-black/85 border border-gray-500/40 px-2 py-2 text-center">
                                <div className="text-gray-400 text-[10px] tracking-[0.2em] mb-0.5">{year}</div>
                                {champName(names[0])}
                                {champName(names[1])}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Jay himself, at the table — the reason there's a cup */}
                <div className="px-6 pb-2">
                    <div className="text-center text-gray-400 text-[10px] tracking-[0.25em] font-serif mb-3">
                        JAY AT THE TABLE
                    </div>
                    <div className="space-y-3">
                        {JAY_PHOTOS.map((p) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                key={p}
                                src={`/jay/${p}.jpg`}
                                alt="Jay Adamson playing Rook"
                                loading="lazy"
                                className="w-full rounded-lg border border-[#5a3a22] shadow-md"
                            />
                        ))}
                    </div>
                    <p className="text-center text-white/50 text-[11px] leading-relaxed mt-3">
                        If you have pictures of Jay, please send them to Riley!
                    </p>
                </div>

                <div className="px-6 pb-6 pt-2">
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-orbitron text-sm"
                    >
                        Close
                    </button>
                </div>
                </div>
            </div>
        </div>
    );
}
