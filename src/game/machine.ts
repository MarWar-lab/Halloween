/**
 * The game's state machine. Pure functions — no I/O, no clock, no Supabase.
 *
 * The shape of the evening is the design, more than any individual card: heat
 * climbs, it never falls, and nobody is asked to perform until they have watched
 * a dozen colleagues survive something smaller. That progression is encoded here
 * rather than left to the host's nerve on the night.
 */

import type { GamePhase, Heat, Mechanic, RoundPhase } from './types';

/** Ordered, so "what comes next" is never a lookup table someone forgets. */
export const GAME_PHASES: GamePhase[] = [
  'lobby',
  'briefing',
  'warmup',
  'round1',
  'intermission',
  'round2',
  'finale',
  'awards',
];

export function nextGamePhase(phase: GamePhase): GamePhase {
  const i = GAME_PHASES.indexOf(phase);
  if (i === -1 || i === GAME_PHASES.length - 1) return 'awards';
  return GAME_PHASES[i + 1];
}

/** The courage dial, driven by the phase rather than by the host's mood. */
export function heatCapFor(phase: GamePhase): Heat {
  switch (phase) {
    case 'lobby':
    case 'briefing':
    case 'warmup':
    case 'round1':
      return 1;
    case 'intermission':
    case 'round2':
      return 2;
    default:
      return 3;
  }
}

/** Which mechanics a phase draws from. */
export function mechanicsFor(phase: GamePhase): Mechanic[] {
  switch (phase) {
    // The warm-up is always all-play: everyone answers at once, so nobody is
    // singled out before the room has warmed up.
    // The warm-up is one-tap only. Nobody should have to type a sentence or
    // be looked at in the first five minutes of a work party.
    case 'warmup':
      return ['split'];
    case 'round1':
      return ['split', 'allplay', 'guesswho', 'solo'];
    case 'round2':
      return ['allplay', 'guesswho', 'solo', 'split'];
    // The finale is duels, so the night ends on a peak rather than trailing off.
    case 'finale':
      return ['duel', 'solo'];
    default:
      return [];
  }
}

/** True where the phase actually plays cards (as opposed to admin phases). */
export const isPlayingPhase = (phase: GamePhase): boolean =>
  mechanicsFor(phase).length > 0;

/**
 * Sub-phase progression within one card. Solo turns start with the player
 * choosing their lane; submit-based mechanics seal, reveal, then vote.
 */
export function roundFlow(mechanic: Mechanic): RoundPhase[] {
  switch (mechanic) {
    // `choosing` used to sit in front of this and had no interface at all —
    // a phase whose only content was the host pressing past it.
    case 'solo':
      return ['performing', 'voting', 'scored'];
    // `revealing` used to sit between these two. It cost the host a click per
    // card to move from "here are the answers" to "now vote on them", when
    // the answers are on screen either way. The host reads them aloud while
    // the room votes.
    case 'allplay':
      return ['submitting', 'voting', 'scored'];
    case 'guesswho':
      return ['submitting', 'voting', 'scored'];
    case 'duel':
      return ['performing', 'voting', 'scored'];
    // One tap, and it is over.
    case 'split':
      return ['voting', 'scored'];
  }
}

export function nextRoundPhase(mechanic: Mechanic, phase: RoundPhase): RoundPhase {
  const flow = roundFlow(mechanic);
  const i = flow.indexOf(phase);
  if (i === -1 || i === flow.length - 1) return 'scored';
  return flow[i + 1];
}

/**
 * Turn order that guarantees everyone plays before anyone plays twice, and
 * reverses each cycle so the person who went first and coldest in round one
 * goes last and warmest in round two.
 */
export function nextTurnPlayer(
  playerIds: string[],
  alreadyPlayed: string[],
  cycle = 0,
): string | null {
  if (playerIds.length === 0) return null;
  const order = cycle % 2 === 1 ? [...playerIds].reverse() : playerIds;
  const played = new Set(alreadyPlayed);
  const remaining = order.filter((id) => !played.has(id));
  if (remaining.length > 0) return remaining[0];
  // Cycle complete — start again from the top of the next ordering.
  const nextOrder = (cycle + 1) % 2 === 1 ? [...playerIds].reverse() : playerIds;
  return nextOrder[0] ?? null;
}

/** Pick the two duellists: the top two on the leaderboard, for a real final. */
export function duelPairing(
  standings: { playerId: string; score: number }[],
): [string, string] | null {
  if (standings.length < 2) return null;
  const sorted = [...standings].sort((a, b) => b.score - a.score);
  return [sorted[0].playerId, sorted[1].playerId];
}

/** Seconds of an evening each phase is budgeted, used by the host's run sheet. */
export const PHASE_MINUTES: Record<GamePhase, number> = {
  lobby: 10,
  briefing: 2,
  warmup: 8,
  round1: 32,
  intermission: 10,
  round2: 36,
  finale: 16,
  awards: 6,
};
