'use client';

// The AlphaRook story — for the family. Why the bots exist, how each one
// was built, what beating (or losing to) them actually means. First draft
// by Claude 2026-07-30; Riley edits welcome, it's just prose in a page.

import { useRouter } from 'next/navigation';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mb-10">
        <h2 className="font-orbitron text-yellow-400 text-lg font-bold mb-3">{title}</h2>
        <div className="space-y-3 text-white/80 text-[15px] leading-relaxed">{children}</div>
    </section>
);

const Bot = ({ emoji, name, gen, story }: { emoji: string; name: string; gen: string; story: string }) => (
    <div className="rounded-xl border border-white/10 bg-navy-950/50 p-3 flex gap-3 items-start">
        <span className="text-2xl leading-none mt-0.5">{emoji}</span>
        <div>
            <div className="font-orbitron text-white text-sm font-bold">
                {name} <span className="text-white/40 font-normal">· {gen}</span>
            </div>
            <div className="text-white/70 text-[13px] leading-relaxed mt-1">{story}</div>
        </div>
    </div>
);

export default function AboutPage() {
    const router = useRouter();
    return (
        <div className="min-h-dvh bg-navy-900">
            <div className="max-w-md mx-auto px-4 py-6">
                <div className="flex items-center justify-between mb-8">
                    <button onClick={() => router.back()} className="text-white/70 hover:text-white flex items-center gap-1 font-orbitron text-sm">
                        <span className="material-symbols-outlined">arrow_back</span> Back
                    </button>
                    <span className="font-orbitron font-bold text-white">ROOK<span className="text-yellow-400">13</span></span>
                </div>

                <h1 className="font-orbitron text-white text-2xl font-bold mb-2">The AlphaRook Story</h1>
                <p className="text-white/50 text-sm mb-10 font-orbitron">How our family card game got a resident superintelligence.</p>

                <Section title="Where it started">
                    <p>
                        Rook13 is our Rook — the rules exactly as the family has always
                        played them, the same game as the kitchen table and the JAY CUP,
                        just on your phone so we can play from three states away.
                    </p>
                    <p>
                        The bots started as a practical thing: four chairs, not always
                        four people. The first ones followed simple family wisdom —
                        count your points, longest suit is trump, don&apos;t bid what you
                        can&apos;t make. Then came a question that wouldn&apos;t leave:
                        <em> what would it take to build a bot that plays Rook really,
                        truly well?</em> Not &quot;pretty good for a computer.&quot; Actually good.
                        Good enough to beat Grandpa on a fair deal.
                    </p>
                </Section>

                <Section title="Teaching a machine to play Rook">
                    <p>
                        There is no book of Rook strategy to program in. So AlphaRook
                        learned the way the famous game AIs learn: by playing itself.
                        Millions of hands, at first bumbling — bidding 120 on garbage,
                        trumping its own partner — and slowly, statistically, learning
                        what wins.
                    </p>
                    <p>
                        The first breakthrough was letting it <strong>watch</strong> a decent
                        player before setting it loose: it cloned our scripted bot&apos;s
                        card play, then improved on it by self-play. The second was
                        bigger: we let it learn to <strong>bid</strong>. Its bidding got so much
                        better that it beat its own previous version while bidding
                        <em> lower</em> — winning more contracts with less risk. That was the
                        day we learned, from the machine, that Rook is a bidding game
                        first and a card game second.
                    </p>
                    <p>
                        Then it learned to <strong>imagine</strong>. A later generation grew a
                        &quot;belief&quot; sense: from the bids and the cards played so far, it
                        estimates who holds what — the same thing Grandma does when she
                        says &quot;he&apos;s out of Yellow, I can feel it.&quot; Bolted onto a search
                        that plays out thousands of imagined futures before each card,
                        that stack ruled the table for weeks.
                    </p>
                </Section>

                <Section title="The wall, and the teacher">
                    <p>
                        Then progress stopped. Eight different attacks on the champion —
                        bigger brains, longer training, exotic tricks — all failed. The
                        gains per generation had been shrinking anyway: 63%, 57%, 55%…
                        We had hit some kind of wall.
                    </p>
                    <p>
                        The way through was patience instead of cleverness. We took our
                        best brain, gave it a deep search and time to think — seconds
                        per card instead of milliseconds — and made THAT the teacher.
                        Five rented computers and this laptop played it against itself
                        for 48 straight hours: <strong>58,000 games, two and a half million
                        hands, sixty million decisions</strong>, every game verified and
                        recorded. Then we trained a new student to imitate the teacher —
                        and the student learned to play the teacher&apos;s moves
                        <em> instantly</em>, no thinking time at all. That student is the
                        strongest reflex player we&apos;ve ever built. It beats every
                        previous generation. It loses only to its own teacher.
                    </p>
                </Section>

                <Section title="AlphaGodRook, the humbling machine">
                    <p>
                        Last question: how good could anyone possibly be? So we built a
                        cheater — on purpose. AlphaGodRook sees all four hands and plays
                        mathematically perfect cards. It is not a fair player; it is a
                        measuring stick.
                    </p>
                    <p>
                        It won about <strong>9 out of 10 games against everything</strong>,
                        including our best bot. In 460 paired games it never once got
                        swept. And it settled a family argument: the gap between our
                        best player and <em>perfect</em> is enormous — what separates us from
                        perfection isn&apos;t luck, it&apos;s all the cards we can&apos;t see. There
                        is a rumor it&apos;s hiding somewhere in the game. If you ever find
                        it, good luck. You&apos;ll need it — and it won&apos;t help you.
                    </p>
                </Section>

                <Section title="The camp roster today">
                    <p>
                        Every bot in the picker is a real generation from this story —
                        the camp ranks them rookie to grandmaster:
                    </p>
                    <div className="space-y-2">
                        <Bot emoji="🐾" name="Cosmo" gen="the teacher" story="The strongest fair player in the family. The deep-search teacher itself, now living in the cloud so your phone doesn't have to do the thinking. Beat the previous champion in 78 of 100 games." />
                        <Bot emoji="🐅" name="Cougar" gen="gen19" story="The previous champion: belief-guided search, the stack that ruled the table before the teacher era." />
                        <Bot emoji="🐈‍⬛" name="Puma" gen="gen16" story="First of the imagination bots — samples worlds from its belief sense before it commits a card." />
                        <Bot emoji="🦁" name="Cub" gen="gen13" story="The belief net itself, played straight — the brain that learned to feel who's out of a suit." />
                        <Bot emoji="🐆" name="Bobcat" gen="gen11" story="The first searcher: plays out imagined futures, gated to the endgame where imagining is honest." />
                        <Bot emoji="🐱" name="Kitten" gen="gen10" story="The last of the pure self-play line — a reflex player through and through." />
                        <Bot emoji="🦖" name="Stomper" gen="gen9" story="The rookie: our first fully neural player, every decision from the net, no training wheels." />
                    </div>
                </Section>

                <Section title="What the machine taught us">
                    <p>
                        Three years of family Rook wisdom, checked by sixty million
                        hands of machine play:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>Bidding is the game.</strong> The single biggest measured leak in everyone&apos;s play — human and machine — is bidding contracts that can&apos;t be made. About 1 in 4 contracts is unmakeable the moment the bid is won.</li>
                        <li><strong>Pick trump first.</strong> The bots that decide trump before shaping the go-down beat the ones that don&apos;t. Dad was right.</li>
                        <li><strong>Short games are luck, long games are skill.</strong> A better player barely shows in one evening; over forty hands the edge is undeniable. Rematch accordingly.</li>
                        <li><strong>The declarer blunders most.</strong> Twice the mistakes of any other seat — winning the bid is where games are lost. Tricks 1–4 carry most of them.</li>
                        <li><strong>The wall is hidden information.</strong> Perfect play with open cards crushes everyone; with hidden hands, even perfection wins only 6 of 10 vs a strong player. Whoever reads the hidden cards better, wins.</li>
                    </ul>
                </Section>

                <Section title="What's next">
                    <p>
                        The teacher now sits at the family table as Cosmo, thinking in
                        the cloud. The next frontier is the one the measurements point
                        at: bidding. And someday — maybe — a family member beats Cosmo
                        over a long series. The bots will be waiting.
                    </p>
                </Section>

                <div className="text-center text-white/30 text-xs font-orbitron pb-8">
                    ROOK13 · built with love (and about sixty million hands of Rook)
                </div>
            </div>
        </div>
    );
}
