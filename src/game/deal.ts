/**
 * Dealing a card: choosing which one, and setting the round up correctly.
 *
 * This lived inside the host console, which meant it could not be tested and a
 * duel shipped with no clock on it for a week. It is pure here: give it the
 * state of the game and it tells you the round to start.
 */

import { draw, type DrawFilter } from './decks';
import { mechanicsFor, roundFlow } from './machine';
import type { Card, Deck, GamePhase, Heat, Mechanic, RoundPhase } from './types';

export interface RoundPlan {
  cardId: string;
  mechanic: Mechanic;
  lane: Card['lane'];
  turnPlayerId: string | null;
  opponentId: string | null;
  phase: RoundPhase;
  /** Null when the opening phase is not one you play against a clock. */
  secs: number | null;
}

/** Phases you perform or write against a timer. `choosing` is not one. */
const TIMED_PHASES: RoundPhase[] = ['submitting', 'performing'];

/**
 * Build the round for a card. The opening phase comes from the mechanic's
 * flow, and it gets a deadline whenever that phase is one you race — which
 * includes a duel, whose flow starts at `performing` with no host click in
 * between to hang a timer on.
 */
export function planFor(
  card: Card,
  seats: { turnPlayerId?: string | null; opponentId?: string | null } = {},
): RoundPlan {
  const phase = roundFlow(card.mechanic)[0];
  return {
    cardId: card.id,
    mechanic: card.mechanic,
    lane: card.lane,
    turnPlayerId: seats.turnPlayerId ?? null,
    opponentId: seats.opponentId ?? null,
    phase,
    secs: TIMED_PHASES.includes(phase) ? card.secs : null,
  };
}

export interface DealContext {
  deck: Deck;
  phase: GamePhase;
  heatCap: Heat;
  usedCardIds: string[];
  /** In seat order. */
  playerIds: string[];
  /** Who has already had a turn of their own. */
  playedPlayerIds: string[];
  /** Standings, used to pick the two finalists for a duel. */
  standings?: { playerId: string; score: number }[];
}

export type DealOutcome =
  | { ok: true; plan: RoundPlan }
  | { ok: false; reason: 'not-a-playing-phase' | 'deck-exhausted' | 'too-few-players' };

/**
 * Pick a card for the phase we are in and seat whoever it needs.
 *
 * Mechanics are tried in a shuffled order so two consecutive rounds rarely feel
 * the same, but the *heat* is never exceeded — the courage dial is the one
 * thing the host is not allowed to overshoot by accident.
 */
export function deal(
  ctx: DealContext,
  rand: () => number = Math.random,
): DealOutcome {
  const mechanics = mechanicsFor(ctx.phase);
  if (mechanics.length === 0) return { ok: false, reason: 'not-a-playing-phase' };

  const filter = (mechanic: Mechanic): DrawFilter => ({
    heatCap: ctx.heatCap,
    usedIds: ctx.usedCardIds,
    mechanic,
  });

  for (const mechanic of shuffle(mechanics, rand)) {
    // A duel needs two people. With fewer, fall through to something else
    // rather than dealing a card that cannot be played.
    if (mechanic === 'duel' && ctx.playerIds.length < 2) continue;

    const card = draw(ctx.deck, filter(mechanic), rand);
    if (!card) continue;

    return { ok: true, plan: planFor(card, seatsFor(mechanic, ctx)) };
  }

  return { ok: false, reason: 'deck-exhausted' };
}

function seatsFor(mechanic: Mechanic, ctx: DealContext) {
  if (mechanic === 'solo') {
    return { turnPlayerId: nextUp(ctx.playerIds, ctx.playedPlayerIds) };
  }
  if (mechanic === 'duel') {
    // The finale is a real final: the two people actually leading it.
    const standings = ctx.standings ?? ctx.playerIds.map((playerId) => ({ playerId, score: 0 }));
    const ranked = [...standings].sort((a, b) => b.score - a.score);
    const [a, b] = ranked;
    if (!a || !b) return {};
    return { turnPlayerId: a.playerId, opponentId: b.playerId };
  }
  return {};
}

/** Everyone gets a turn before anybody gets a second one. */
function nextUp(playerIds: string[], played: string[]): string | null {
  const done = new Set(played);
  return playerIds.find((id) => !done.has(id)) ?? playerIds[0] ?? null;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
