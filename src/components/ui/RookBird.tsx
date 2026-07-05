// The Rook13 mark: a stylized rook holding a fan of cards, echoing the
// classic Rook card back the family grew up with. Single-color (currentColor)
// so it can be embossed on the felt, printed on card backs, or used as an
// icon anywhere.

export default function RookBird({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <svg
            viewBox="0 0 120 130"
            className={className}
            style={style}
            fill="currentColor"
            aria-hidden="true"
        >
            {/* body: head (facing left, beak open mid-caw), arched back, long tail */}
            <path
                fillRule="evenodd"
                d="M44 4
                   C 36 4, 30 9, 28 15
                   L 6 10 L 29 20
                   L 12 30 L 31 25
                   C 33 31, 36 34, 40 36
                   C 36 44, 33 54, 34 64
                   C 35 76, 40 86, 48 92
                   L 46 112 L 50 112 L 53 94
                   C 55 95, 57 96, 60 96
                   L 59 112 L 63 112 L 65 96
                   C 78 94, 88 84, 92 70
                   L 112 122 L 96 66
                   C 98 54, 94 40, 84 30
                   C 76 22, 66 18, 58 18
                   C 56 10, 51 4, 44 4
                   Z
                   M 43 13 a 3 3 0 1 1 0.001 0 Z"
            />
            {/* fan of five cards held out in front of the chest */}
            <g>
                <rect x="4" y="52" width="16" height="24" rx="2.5" transform="rotate(-32 12 64)" />
                <rect x="10" y="46" width="16" height="24" rx="2.5" transform="rotate(-16 18 58)" />
                <rect x="17" y="43" width="16" height="24" rx="2.5" transform="rotate(0 25 55)" />
                <rect x="24" y="44" width="16" height="24" rx="2.5" transform="rotate(16 32 56)" />
                <rect x="31" y="48" width="16" height="24" rx="2.5" transform="rotate(32 39 60)" />
            </g>
        </svg>
    );
}
