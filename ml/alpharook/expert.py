"""Expert-iteration self-play (gen19): the learner's card play runs through
the champion SEARCH STACK — PIMC + Q-prior shrinkage + belief-guided worlds —
and the games it plays become ordinary DMC training rows.

Riley's framing (2026-07-18): "play the hand 100x and hone in on the winning
line." Formally this is expert iteration, AlphaZero's loop: search plays
better than the raw net, the net regresses the searched games' outcomes, and
the improved net makes next round's search stronger. The four-strike law
(gen12 x2, gen14 x2: any concentrated OFFLINE objective corrupts a
DMC-converged net's calibration) says search-improved play must be generated
INSIDE the on-policy loop — this is that, in the simplest shape that can
work: no target surgery at all, just a stronger behavior policy. Rows stay
(state, action_taken, blended outcome), identical to vanilla DMC; the
improvement enters through better trajectories, not altered labels.

A searched play is ~2 orders slower than a reflex pass, so these games come
from a few dedicated SEARCH WORKERS (workers.py) while the rest of the pool
keeps the fast reflex firehose going — the majority reflex rows are the
calibration anchor, in gen12's terms.

Exploration: searched plays are the expert and stay clean (world sampling is
their diversity); pre-gate plays fall back to the net's greedy reflex inside
SearchAgent. Bids keep the guided bid-eps floor — pacifism is the documented
failure mode and bids are never searched (winner's curse, gen11).
"""

from __future__ import annotations

import random

import numpy as np
import torch

from rook.cards import team_of
from rook.bots import next_bot_action, choose_bid, best_trump_suit
from rook.engine import WIDOW as PHASE_WIDOW
from rook.observation import observe
from .encoder import encode_state_for, encode_action, D_BID, D_DISCARD, D_TRUMP, D_PLAY
from .env import SelfPlayGame
from .selfplay import belief_target, game_targets, hand_targets


class SearchSelfPlay:
    """One env, sequential decisions, learner plays through SearchAgent.
    Same .play() contract and row/stats format as VecSelfPlay so WorkerPool
    can mix both kinds of worker in one batch."""

    def __init__(self, seed: int = 0, opponent_mix: float = 0.0,
                 opponent_style: str = "basic", bid_eps: float = 0.15,
                 script_dtypes: frozenset = frozenset(),
                 opponent_ckpt: str | None = None,
                 opponent_script: frozenset = frozenset(),
                 worlds: int = 12, min_trick: int = 3, prior: float = 2.0,
                 belief_ckpt: str | None = None, belief_temp: float = 0.5):
        self.rng = random.Random(seed)
        self.opponent_mix = opponent_mix
        self.opponent_style = opponent_style
        self.bid_eps = bid_eps
        self.script_dtypes = script_dtypes
        self.opp_script = opponent_script
        self.worlds = worlds
        self.min_trick = min_trick
        self.prior = prior
        self.styles = [opponent_style] * 4
        self.opp_net = None
        if opponent_ckpt:
            from .model import load_qnet
            self.opp_net = load_qnet(opponent_ckpt)
        self.belief = None
        if belief_ckpt:
            from .beliefs import BeliefOracle
            self.belief = BeliefOracle(belief_ckpt, temp=belief_temp)
        self.agent = None  # (re)built when the learner net object changes
        self._agent_net = None
        self.games_done = 0

    def _ensure_agent(self, net) -> None:
        if self._agent_net is not net:
            from .search import SearchAgent
            self.agent = SearchAgent(net, worlds=self.worlds,
                                     search_dtypes=frozenset({D_PLAY}),
                                     prior_weight=self.prior,
                                     min_trick=self.min_trick,
                                     belief=self.belief)
            self._agent_net = net

    def _net_argmax(self, net, env, seat: int, dtype: int, cands: list) -> int:
        s = encode_state_for(net, observe(env.g, seat), env.picks, dtype,
                             env.g, env.trump_intent)
        S = torch.from_numpy(np.stack([s] * len(cands)))
        A = torch.from_numpy(np.stack([encode_action(dtype, a) for a in cands]))
        with torch.no_grad():
            q = net(S, A)
        return int(q.argmax().item())

    @torch.no_grad()
    def play(self, net, device, epsilon: float, min_samples: int):
        net.eval()
        self._ensure_agent(net)
        out: list = []
        stats = {"games": 0, "hands": 0, "sets": 0, "bids": 0,
                 "mix_games": 0, "mix_wins": 0, "search_games": 0}

        while len(out) < min_samples:
            env = SelfPlayGame(self.rng.randrange(1 << 30))
            mode = (self.rng.randrange(2)
                    if self.rng.random() < self.opponent_mix else None)
            pending_gd: list[int] = []
            buf: list = []

            while not env.done:
                seat, dtype, cands = env.decision()
                scripted_seat = mode is not None and team_of(seat) != mode
                scripted_phase = dtype in self.script_dtypes

                if scripted_seat or scripted_phase:
                    # --- opponent / curriculum seats, mirroring VecSelfPlay ---
                    if (scripted_seat and self.opp_net is not None
                            and dtype not in self.opp_script):
                        j = self._net_argmax(self.opp_net, env, seat, dtype, cands)
                        env.apply(cands[j])
                    elif dtype == D_TRUMP and env.g.phase == PHASE_WIDOW:
                        env.apply(best_trump_suit(env.g.hands[seat]))
                    elif dtype == D_DISCARD:
                        if not pending_gd:
                            _, _, cards = next_bot_action(env.g, self.styles, self.rng)
                            pending_gd = list(cards)
                        env.apply(pending_gd.pop(0))
                    else:
                        _, _, action = next_bot_action(env.g, self.styles, self.rng)
                        env.apply(action)
                    continue

                # --- the learner ---
                if dtype == D_PLAY:
                    # the expert: search from the gate on, reflex before it
                    # (SearchAgent gates internally); no epsilon — world
                    # sampling is the searched move's diversity
                    action = self.agent.choose(env, seat, dtype, cands)
                    j = cands.index(action)
                else:
                    # bids / go-down / trump intent: same eps-greedy the
                    # reflex workers use, incl. guided bid exploration
                    eff_eps = max(epsilon, self.bid_eps) if dtype == D_BID else epsilon
                    j = None
                    if self.rng.random() < eff_eps:
                        if dtype == D_BID and self.rng.random() < 0.5:
                            h = choose_bid(env.g, seat, "basic")
                            if h in cands:
                                j = cands.index(h)
                        if j is None:
                            j = self.rng.randrange(len(cands))
                    else:
                        j = self._net_argmax(net, env, seat, dtype, cands)

                s_vec = encode_state_for(net, observe(env.g, seat), env.picks,
                                         dtype, env.g, env.trump_intent)
                a_vec = encode_action(dtype, cands[j])
                bt, bm = belief_target(env.g, seat)
                buf.append((s_vec, a_vec, team_of(seat), env.g.hand_number, bt, bm))
                env.apply(cands[j])

            # --- label the finished game exactly like VecSelfPlay ---
            t0, t1 = game_targets(env)
            hmap = hand_targets(env)
            from .selfplay import HAND_WEIGHT, GAME_WEIGHT
            for s_vec, a_vec, team, hand_no, bt, bm in buf:
                game_t = t0 if team == 0 else t1
                hand_t = hmap[hand_no][team]
                out.append((s_vec, a_vec,
                            HAND_WEIGHT * hand_t + GAME_WEIGHT * game_t, bt, bm))
            stats["games"] += 1
            stats["search_games"] += 1
            stats["hands"] += len(env.g.hand_history)
            stats["sets"] += sum(1 for h in env.g.hand_history if h[6])
            stats["bids"] += len(env.g.hand_history)
            if mode is not None:
                stats["mix_games"] += 1
                stats["mix_wins"] += 1 if env.g.winner == mode else 0
            self.games_done += 1
        return out, stats
