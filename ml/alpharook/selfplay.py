"""Vectorized self-play: N full games advance in lockstep, and every step all
pending (state, candidate-action) rows across all games go through the net in
ONE forward pass — that batching is what makes pure-Python self-play fast
enough on a MacBook.

Each decision becomes a training sample; when a game finishes, every sample
is labeled with a blend of how ITS HAND went and how the game ended:

    hand  = clip(hand_score_diff / 200, ±1)          # dense, per-decision credit
    game  = 0.7 * win/loss(±1) + 0.3 * clip(score_diff / 500, ±1)
    target = 0.5 * hand + 0.5 * game

Full-game win/loss alone is a cliff, not a slope: a random team wins 0/40
full games vs Standard, so an improving-but-losing net gets the same "-1,
everything was bad" label on every decision of every mixed game — no ranking
gradient. The per-hand term restores it: hands where you set the opponents
score differently from hands where you got set. The game term stays so the
net still sees score context (-250..500) and can learn endgame bidding.

League play (`opponent_mix`): a fraction of games seat scripted heuristic
bots as the opposing team, giving the net direct gradient against the bot it
must beat — pure self-play at laptop scale drifts into a private meta that
never transfers (gen1 flatlined at ~0% vs Standard while its self-play loss
kept improving). Only the net's own decisions become training samples.
"""

from __future__ import annotations

import random

import numpy as np
import torch

from rook.cards import team_of
from rook.bots import next_bot_action, choose_bid, best_trump_suit
from rook.engine import WIDOW as PHASE_WIDOW
from rook.observation import observe
from .encoder import (
    encode_state_for, encode_action, D_BID, D_DISCARD, D_TRUMP, D_PLAY,
)
from .env import SelfPlayGame

WIN_WEIGHT = 0.7
DIFF_WEIGHT = 0.3
HAND_WEIGHT = 0.5
GAME_WEIGHT = 0.5

# curriculum stages, by what the family heuristic still handles
SCRIPT_MODES = {
    "openings": frozenset({D_BID, D_DISCARD, D_TRUMP}),  # net learns play only
    "godown": frozenset({D_DISCARD, D_TRUMP}),  # net learns bidding + play
    "bid": frozenset({D_BID}),                  # net learns go-down + play
    "none": frozenset(),
}


def game_targets(env: SelfPlayGame) -> tuple[float, float]:
    """Final game-level result for team 0 and team 1."""
    s = env.g.scores
    out = []
    for t in (0, 1):
        wl = 1.0 if env.g.winner == t else -1.0
        diff = max(-1.0, min(1.0, (s[t] - s[1 - t]) / 500.0))
        out.append(WIN_WEIGHT * wl + DIFF_WEIGHT * diff)
    return out[0], out[1]


def hand_targets(env: SelfPlayGame) -> dict[int, tuple[float, float]]:
    """Per hand_number, the normalized hand-score diff for team 0 and 1."""
    out: dict[int, tuple[float, float]] = {}
    for h in env.g.hand_history:
        hand_no, d_a, d_b = h[0], h[4], h[5]
        da = max(-1.0, min(1.0, (d_a - d_b) / 200.0))
        out[hand_no] = (da, -da)
    return out


class VecSelfPlay:
    def __init__(self, n_envs: int, seed: int = 0, opponent_mix: float = 0.0,
                 opponent_style: str = "basic", bid_eps: float = 0.15,
                 script_dtypes: frozenset = frozenset(),
                 opponent_ckpt: str | None = None,
                 opponent_script: frozenset = frozenset()):
        self.rng = random.Random(seed)
        self.opponent_mix = opponent_mix
        self.opponent_style = opponent_style
        # Champion-ladder training: mixed games can seat a FROZEN net as the
        # opposing team instead of the scripted heuristic. The learner's live
        # mix_win_rate then reads "am I beating the reigning champion".
        self.opp_net = None
        self.opp_script = opponent_script
        if opponent_ckpt:
            from .model import load_qnet
            self.opp_net = load_qnet(opponent_ckpt)
        # Curriculum control: decision types in script_dtypes are made by the
        # family heuristic for EVERY seat (no training samples). Weak declarer
        # play makes bidding genuinely -EV, so a bid-learning net correctly
        # collapses to pass-always (gen4: 0/141 bids won) and never gets
        # declarer practice — the same chicken-and-egg the TS AlphaRook broke
        # by shipping search play first, search bidding second. Stages:
        #   {BID, DISCARD, TRUMP} -> learn play only (gen5/6)
        #   {BID}                 -> learn play + go-down + trump (gen7+)
        #   {}                    -> learn everything (final stage)
        self.script_dtypes = script_dtypes
        # Exploration floor for BID decisions specifically. Bidding's downside
        # (going set) arrives long before its upside is learnable, so a greedy
        # net collapses into pass-always — 0 bids won in 92 hands vs Standard —
        # and then never practices declarer play at all. Card-play epsilon can
        # decay; bid exploration must not.
        self.bid_eps = bid_eps
        self.styles = [opponent_style] * 4
        n = n_envs
        self.envs: list[SelfPlayGame] = [None] * n  # type: ignore[list-item]
        self.modes: list[int | None] = [None] * n   # None = self-play, else net's team
        self.pending_gd: list[list[int]] = [[] for _ in range(n)]
        # per env: list of (state_vec, action_vec, team, hand_number)
        self.bufs: list[list] = [[] for _ in range(n)]
        self.games_done = 0
        for i in range(n):
            self._reset_env(i)

    def _reset_env(self, i: int) -> None:
        self.envs[i] = SelfPlayGame(self.rng.randrange(1 << 30))
        self.modes[i] = (self.rng.randrange(2)
                         if self.rng.random() < self.opponent_mix else None)
        self.pending_gd[i] = []
        self.bufs[i] = []

    def _next_net_decision(self, i: int):
        """Advance env i through scripted-opponent decisions until the net
        must act. Returns (seat, dtype, candidates) or None if the game ended
        on a scripted move."""
        env, mode = self.envs[i], self.modes[i]
        while not env.done:
            seat, dtype, cands = env.decision()
            scripted_seat = mode is not None and team_of(seat) != mode
            scripted_phase = dtype in self.script_dtypes
            if not scripted_seat and not scripted_phase:
                return seat, dtype, cands
            if (scripted_seat and self.opp_net is not None
                    and dtype not in self.opp_script):
                # frozen champion opponent decides
                import numpy as _np
                import torch as _torch
                from rook.observation import observe as _obs
                s = encode_state_for(self.opp_net, _obs(env.g, seat),
                                     env.picks, dtype, env.g,
                                     env.trump_intent)
                S = _torch.from_numpy(_np.stack([s] * len(cands)))
                A = _torch.from_numpy(
                    _np.stack([encode_action(dtype, a) for a in cands]))
                with _torch.no_grad():
                    q = self.opp_net(S, A)
                env.apply(cands[int(q.argmax().item())])
                continue
            if dtype == D_TRUMP and env.g.phase == PHASE_WIDOW:
                # trump intent for a scripted seat: the family law
                env.apply(best_trump_suit(env.g.hands[seat]))
                continue
            if dtype == D_DISCARD:
                if not self.pending_gd[i]:
                    _, _, cards = next_bot_action(env.g, self.styles, self.rng)
                    self.pending_gd[i] = list(cards)
                env.apply(self.pending_gd[i].pop(0))
            else:
                _, _, action = next_bot_action(env.g, self.styles, self.rng)
                env.apply(action)
        return None

    def _flush_finished(self, i: int, out: list, stats: dict) -> None:
        env, mode = self.envs[i], self.modes[i]
        t0, t1 = game_targets(env)
        hmap = hand_targets(env)
        for s_vec, a_vec, team, hand_no in self.bufs[i]:
            game_t = t0 if team == 0 else t1
            hand_t = hmap[hand_no][team]
            out.append((s_vec, a_vec,
                        HAND_WEIGHT * hand_t + GAME_WEIGHT * game_t))
        stats["games"] += 1
        stats["hands"] += len(env.g.hand_history)
        stats["sets"] += sum(1 for h in env.g.hand_history if h[6])
        stats["bids"] += len(env.g.hand_history)
        if mode is not None:
            stats["mix_games"] += 1
            stats["mix_wins"] += 1 if env.g.winner == mode else 0
        self.games_done += 1
        self._reset_env(i)

    @torch.no_grad()
    def play(self, net, device, epsilon: float, min_samples: int):
        """Returns (samples, stats): samples = list of (state, action, target),
        stats aggregates finished games. mix_wins/mix_games track the net's
        live win rate in scripted-opponent games — the transfer signal."""
        out: list[tuple[np.ndarray, np.ndarray, float]] = []
        stats = {"games": 0, "hands": 0, "sets": 0, "bids": 0,
                 "mix_games": 0, "mix_wins": 0}
        net.eval()

        while len(out) < min_samples:
            # ---- gather the net's pending decision in every env ----
            seats, dtypes, cands_all, state_rows, action_rows, seg = [], [], [], [], [], [0]
            for i in range(len(self.envs)):
                dec = self._next_net_decision(i)
                while dec is None:  # game ended on a scripted move
                    self._flush_finished(i, out, stats)
                    dec = self._next_net_decision(i)
                seat, dtype, cands = dec
                env = self.envs[i]
                s = encode_state_for(net, observe(env.g, seat), env.picks,
                                     dtype, env.g, env.trump_intent)
                seats.append(seat)
                dtypes.append(dtype)
                cands_all.append(cands)
                for a in cands:
                    state_rows.append(s)
                    action_rows.append(encode_action(dtype, a))
                seg.append(seg[-1] + len(cands))

            S = torch.from_numpy(np.stack(state_rows)).to(device)
            A = torch.from_numpy(np.stack(action_rows)).to(device)
            q = net(S, A).cpu().numpy()

            # ---- pick, record, apply ----
            for i, env in enumerate(self.envs):
                lo, hi = seg[i], seg[i + 1]
                is_bid = dtypes[i] == D_BID
                eff_eps = max(epsilon, self.bid_eps) if is_bid else epsilon
                if self.rng.random() < eff_eps:
                    # Guided bid exploration: uniform-random bids are almost
                    # always terrible (jump to 110 on junk -> set -> "bidding
                    # is bad"), so half of bid exploration follows the family
                    # heuristic instead — sensible contracts get sampled and
                    # valued, and Q-learning keeps the final say.
                    j = None
                    if is_bid and self.rng.random() < 0.5:
                        h = choose_bid(env.g, seats[i], "basic")
                        if h in cands_all[i]:
                            j = cands_all[i].index(h)
                    if j is None:
                        j = self.rng.randrange(hi - lo)
                else:
                    j = int(np.argmax(q[lo:hi]))
                self.bufs[i].append(
                    (state_rows[lo + j], action_rows[lo + j],
                     team_of(seats[i]), env.g.hand_number))
                env.apply(cands_all[i][j])
                if env.done:
                    self._flush_finished(i, out, stats)
        return out, stats
