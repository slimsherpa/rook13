/* THE ORACLE, in C — a line-for-line port of rook/solver.py (2026-08-04).
 *
 * Same rules, same algorithm, same answers: bitboard hands (40 cards in a
 * uint64), equivalent-card collapsing, alpha-beta with a transposition
 * table at trick boundaries, zero-window binary search on the value.
 * Exactness does not depend on move order or TT policy — those only buy
 * speed — so parity with the Python solver is testable to the point:
 * identical values on every position (tests/test_csolver_parity.py).
 *
 * Build:  cc -O3 -shared -fPIC csolver.c -o _csolver.so
 * API (ctypes, see rook/csolver.py):
 *   void rk_init(uint64_t tt_entries);       // power of two; 0 = default
 *   int  rk_solve(...);                      // team-0 points from here
 *   void rk_play_values(..., int32_t *out);  // out[40], -1 = not priced
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define TOTAL_POINTS 120
#define NONE (-1)

static const int RANK_PTS[10] = {5, 0, 0, 0, 0, 10, 0, 0, 10, 0};

static inline int card_pts(int c) { return RANK_PTS[c % 10]; }
static inline int suit_of(int c) { return c / 10; }
static inline int rank_of(int c) { return c % 10; }
static inline int team_of(int s) { return s & 1; }

/* ---- transposition table: open addressing, replace-always ---- */
typedef struct {
    uint64_t key;
    int16_t lo, hi;
    int8_t mv;   /* best move for ordering; -1 none */
    uint8_t used;
} TTE;

static TTE *TT = NULL;
static uint64_t TT_MASK = 0;

void rk_init(uint64_t entries) {
    if (TT) { free(TT); TT = NULL; }
    if (!entries) entries = 1u << 20;            /* ~16 MB default */
    /* round down to power of two */
    while (entries & (entries - 1)) entries &= entries - 1;
    TT = calloc(entries, sizeof(TTE));
    TT_MASK = entries - 1;
}

static inline uint64_t mix(uint64_t x) {         /* splitmix64 */
    x += 0x9E3779B97F4A7C15ULL;
    x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
    x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
    return x ^ (x >> 31);
}

static inline uint64_t pos_key(const uint64_t h[4], int turn, int t0) {
    uint64_t k = mix(h[0]) ^ mix(h[1] * 3 + 1) ^ mix(h[2] * 5 + 2)
               ^ mix(h[3] * 7 + 3) ^ mix(((uint64_t)turn << 3) | t0);
    return k ? k : 1;
}

/* ---- solver state (per top-level call; single-threaded per process,
 * matching the one-worker-per-core fleet pattern) ---- */
static int G_trump, G_gd, G_ntricks, G_bonus_at, G_bonus;

static inline uint64_t suit_mask(int s) { return 0x3FFULL << (s * 10); }

static inline uint64_t legal_of(uint64_t hand, int lead) {
    if (lead < 0) return hand;
    uint64_t follow = hand & suit_mask(lead);
    return follow ? follow : hand;
}

static inline int beats(int card, int best, int lead) {
    int c_tr = (G_trump >= 0) && suit_of(card) == G_trump;
    int b_tr = (G_trump >= 0) && suit_of(best) == G_trump;
    if (c_tr != b_tr) return c_tr;
    if (suit_of(card) != suit_of(best)) return 0;
    return rank_of(card) > rank_of(best);
    (void)lead;
}

/* legal plays with equivalent cards collapsed; high cards first, trump
 * suit first (ordering is a speed heuristic only). Returns count. */
static int candidates(uint64_t legal, uint64_t live, int trump, int *out) {
    int n = 0;
    for (int s = 0; s < 4; s++) {
        int sub = (int)((legal >> (s * 10)) & 0x3FF);
        if (!sub) continue;
        int lv = (int)((live >> (s * 10)) & 0x3FF);
        int base = s * 10, keep = -1;
        for (int r = 9; r >= 0; r--) {
            if (!((sub >> r) & 1)) continue;
            if (keep >= 0 && RANK_PTS[r] == RANK_PTS[keep] &&
                !(lv & ((1 << keep) - (1 << (r + 1))))) {
                keep = r;                 /* same run: extend, emit nothing */
                continue;
            }
            out[n++] = base + r;
            keep = r;
        }
    }
    /* insertion sort desc by (is_trump, rank) — mirrors the Python key */
    for (int i = 1; i < n; i++) {
        int c = out[i];
        long kc = ((long)((trump >= 0) && suit_of(c) == trump) << 8)
                | rank_of(c);
        int j = i - 1;
        while (j >= 0) {
            int d = out[j];
            long kd = ((long)((trump >= 0) && suit_of(d) == trump) << 8)
                    | rank_of(d);
            if (kd >= kc) break;
            out[j + 1] = d;
            j--;
        }
        out[j + 1] = c;
    }
    return n;
}

static int go(uint64_t h[4], int turn, int t0, int done, int alpha, int beta,
              int tlen, const int *tseat, const int *tcard) {
    if (done == G_ntricks)
        return t0 >= G_bonus_at ? G_bonus : 0;

    int store = (tlen == 0);
    int prev = -1;
    uint64_t key = 0;
    TTE *e = NULL;
    if (store && TT) {
        key = pos_key(h, turn, t0);
        e = &TT[key & TT_MASK];
        if (e->used && e->key == key) {
            prev = e->mv;
            int lo = e->lo, hi = e->hi;
            if (lo == hi) return lo;
            if (lo >= beta) return lo;
            if (hi <= alpha) return hi;
            if (lo > alpha) alpha = lo;
            if (hi < beta) beta = hi;
        }
    }
    int a0 = alpha, b0 = beta;

    int lead = tlen ? suit_of(tcard[0]) : -1;
    uint64_t live = h[0] | h[1] | h[2] | h[3];
    int moves[12];
    int nm = candidates(legal_of(h[turn], lead), live, G_trump, moves);
    if (prev >= 0 && nm > 0 && moves[0] != prev) {
        for (int i = 1; i < nm; i++)
            if (moves[i] == prev) {
                memmove(moves + 1, moves, i * sizeof(int));
                moves[0] = prev;
                break;
            }
    }

    int maxing = (team_of(turn) == 0);
    int best = maxing ? -1 : TOTAL_POINTS + 1;
    int best_mv = -1;
    for (int i = 0; i < nm; i++) {
        int c = moves[i];
        uint64_t nh[4] = {h[0], h[1], h[2], h[3]};
        nh[turn] &= ~(1ULL << c);
        int v;
        if (tlen < 3) {
            int ns[4], nc[4];
            memcpy(ns, tseat, tlen * sizeof(int));
            memcpy(nc, tcard, tlen * sizeof(int));
            ns[tlen] = turn; nc[tlen] = c;
            v = go(nh, (turn + 1) & 3, t0, done, alpha, beta,
                   tlen + 1, ns, nc);
        } else {
            int ws = tseat[0], wc = tcard[0];
            int lead2 = suit_of(tcard[0]);
            for (int j = 1; j < 3; j++)
                if (beats(tcard[j], wc, lead2)) { ws = tseat[j]; wc = tcard[j]; }
            if (beats(c, wc, lead2)) { ws = turn; wc = c; }
            int pts = card_pts(tcard[0]) + card_pts(tcard[1])
                    + card_pts(tcard[2]) + card_pts(c);
            int won0 = (team_of(ws) == 0);
            int gained = won0 ? pts : 0;
            if (done == G_ntricks - 1 && won0) gained += G_gd;
            v = gained + go(nh, ws, t0 + won0, done + 1,
                            alpha - gained, beta - gained, 0, tseat, tcard);
        }
        if (maxing) {
            if (v > best) { best = v; best_mv = c; }
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        } else {
            if (v < best) { best = v; best_mv = c; }
            if (best < beta) beta = best;
            if (alpha >= beta) break;
        }
    }

    if (store && TT) {
        e->key = key;
        e->used = 1;
        e->lo = (int16_t)(best > a0 ? best : 0);
        e->hi = (int16_t)(best < b0 ? best : TOTAL_POINTS);
        e->mv = (int8_t)best_mv;
    }
    return best;
}

static int popcnt64(uint64_t x) {
#if defined(__GNUC__) || defined(__clang__)
    return __builtin_popcountll(x);
#else
    int n = 0; while (x) { x &= x - 1; n++; } return n;
#endif
}

static void setup(const uint64_t h[4], int trump, int gd, int tricks_done,
                  int tlen, const int *tseat, int bonus_at, int bonus) {
    G_trump = trump; G_gd = gd; G_bonus_at = bonus_at; G_bonus = bonus;
    int mx = 0;
    for (int s = 0; s < 4; s++) {
        int in_trick = 0;
        for (int j = 0; j < tlen; j++) if (tseat[j] == s) in_trick = 1;
        int k = popcnt64(h[s]) + in_trick;
        if (k > mx) mx = k;
    }
    G_ntricks = tricks_done + mx;
    if (!TT) rk_init(0);
    /* fresh cache per top-level call: matches Python's per-call _Solver */
    memset(TT, 0, (TT_MASK + 1) * sizeof(TTE));
}

static int binary_search_value(uint64_t h[4], int turn, int t0, int done,
                               int tlen, const int *tseat, const int *tcard) {
    int on_table = 0;
    uint64_t live = h[0] | h[1] | h[2] | h[3];
    while (live) {
        int c = __builtin_ctzll(live);
        on_table += card_pts(c);
        live &= live - 1;
    }
    for (int j = 0; j < tlen; j++) on_table += card_pts(tcard[j]);
    int hi_v = on_table + G_gd + G_bonus;
    int step = (G_gd % 5 == 0 && G_bonus % 5 == 0) ? 5 : 1;
    int lo_k = 0, hi_k = hi_v / step;
    while (lo_k < hi_k) {
        int mid = ((lo_k + hi_k + 1) / 2) * step;
        int v = go(h, turn, t0, done, mid - 1, mid, tlen, tseat, tcard);
        if (v >= mid) lo_k = mid / step;
        else hi_k = mid / step - 1;
    }
    return lo_k * step;
}

int rk_solve(uint64_t h0, uint64_t h1, uint64_t h2, uint64_t h3,
             int trump, int leader, int gd, int t0_tricks, int tricks_done,
             int bonus_at, int bonus,
             int tlen, const int32_t *tseat, const int32_t *tcard) {
    uint64_t h[4] = {h0, h1, h2, h3};
    int ts[4] = {0}, tc[4] = {0};
    for (int j = 0; j < tlen; j++) { ts[j] = tseat[j]; tc[j] = tcard[j]; }
    setup(h, trump, gd, tricks_done, tlen, ts, bonus_at, bonus);
    int turn = tlen ? (ts[tlen - 1] + 1) & 3 : leader;
    return binary_search_value(h, turn, t0_tricks, tricks_done, tlen, ts, tc);
}

void rk_play_values(uint64_t h0, uint64_t h1, uint64_t h2, uint64_t h3,
                    int trump, int leader, int gd, int t0_tricks,
                    int tricks_done, int bonus_at, int bonus,
                    int tlen, const int32_t *tseat, const int32_t *tcard,
                    const int8_t *only, int32_t *out40) {
    uint64_t h[4] = {h0, h1, h2, h3};
    int ts[4] = {0}, tc[4] = {0};
    for (int j = 0; j < tlen; j++) { ts[j] = tseat[j]; tc[j] = tcard[j]; }
    setup(h, trump, gd, tricks_done, tlen, ts, bonus_at, bonus);
    int turn = tlen ? (ts[tlen - 1] + 1) & 3 : leader;
    int lead = tlen ? suit_of(tc[0]) : -1;
    for (int c = 0; c < 40; c++) out40[c] = -1;

    int opts[12];
    int n = candidates(legal_of(h[turn], lead),
                       h[0] | h[1] | h[2] | h[3], -2 /* no trump-first */,
                       opts);
    int use[12];
    int nu = 0;
    if (only) {
        for (int i = 0; i < n; i++)
            if (only[opts[i]]) use[nu++] = opts[i];
        if (!nu) {   /* collapsed-twin fallback: raw legal ∩ only */
            uint64_t lg = legal_of(h[turn], lead);
            while (lg) {
                int c = __builtin_ctzll(lg);
                if (only[c] && nu < 12) use[nu++] = c;
                lg &= lg - 1;
            }
        }
    } else {
        for (int i = 0; i < n; i++) use[nu++] = opts[i];
    }

    for (int i = 0; i < nu; i++) {
        int c = use[i];
        uint64_t nh[4] = {h[0], h[1], h[2], h[3]};
        nh[turn] &= ~(1ULL << c);
        if (tlen < 3) {
            int ns[4], nc2[4];
            memcpy(ns, ts, tlen * sizeof(int));
            memcpy(nc2, tc, tlen * sizeof(int));
            ns[tlen] = turn; nc2[tlen] = c;
            out40[c] = binary_search_value(nh, (turn + 1) & 3, t0_tricks,
                                           tricks_done, tlen + 1, ns, nc2);
        } else {
            int ws = ts[0], wc = tc[0];
            int lead2 = suit_of(tc[0]);
            for (int j = 1; j < 3; j++)
                if (beats(tc[j], wc, lead2)) { ws = ts[j]; wc = tc[j]; }
            if (beats(c, wc, lead2)) { ws = turn; wc = c; }
            int pts = card_pts(tc[0]) + card_pts(tc[1]) + card_pts(tc[2])
                    + card_pts(c);
            int won0 = (team_of(ws) == 0);
            int gained = won0 ? pts : 0;
            if (tricks_done == G_ntricks - 1 && won0) gained += G_gd;
            int e4[1] = {0};
            out40[c] = gained + binary_search_value(
                nh, ws, t0_tricks + won0, tricks_done + 1, 0,
                (const int *)e4, (const int *)e4);
        }
    }
}
