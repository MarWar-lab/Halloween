/**
 * Holding the evening to three quarters of an hour.
 *
 * The run of show used to budget two hours, which is not a party game, it is a
 * meeting. Worse, nothing anywhere measured the real elapsed time against the
 * plan, so a host had no way to know they were forty minutes over until people
 * started leaving.
 *
 * Everything here is derived from two facts already on the snapshot — when the
 * game was created, and how many cards have been dealt — so it needs no new
 * columns and works identically on both backends.
 */

import { GAME_PHASES } from './machine';
import type { Game, GamePhase } from './types';

/** What the whole thing is meant to cost, door to door. */
export const TARGET_MINUTES = 45;

/**
 * Minutes budgeted per chapter. Lobby is people arriving rather than playing,
 * and is the first thing a host should compress when the room is already
 * there.
 */
export const PHASE_MINUTES: Record<GamePhase, number> = {
  lobby: 5,
  briefing: 1,
  warmup: 5,
  round1: 12,
  intermission: 3,
  round2: 12,
  finale: 5,
  awards: 2,
};

/**
 * Cards each chapter should get through.
 *
 * Derived from what a card actually costs once you include reading it aloud
 * and the laughing afterwards: about a minute and a half for a one-tap card,
 * three for anything written.
 */
export const CARDS_PER_PHASE: Record<GamePhase, number> = {
  lobby: 0,
  briefing: 0,
  warmup: 3,
  round1: 4,
  intermission: 0,
  round2: 4,
  finale: 2,
  awards: 0,
};

export const PLANNED_CARDS = Object.values(CARDS_PER_PHASE).reduce((a, b) => a + b, 0);

/** Minutes that should have passed by the time a chapter begins. */
export function minutesBefore(phase: GamePhase): number {
  let total = 0;
  for (const p of GAME_PHASES) {
    if (p === phase) break;
    total += PHASE_MINUTES[p];
  }
  return total;
}

export interface Pacing {
  /** 1-based, for "chapter 4 of 8". */
  chapter: number;
  chapterCount: number;
  cardsPlayed: number;
  cardsPlanned: number;
  minutesElapsed: number;
  minutesTarget: number;
  /** Minutes the plan says should have passed by now. */
  minutesExpected: number;
  /**
   * How the evening is running. `behind` is the one that matters: it is the
   * cue to stop dealing and move the chapter on.
   */
  state: 'ahead' | 'on-time' | 'behind';
  /** 0-1, for a bar. Clamped, because a long game should not overflow it. */
  fraction: number;
}

export function pacingFor(game: Game, usedCardIds: string[], nowMs = Date.now()): Pacing {
  const chapter = Math.max(0, GAME_PHASES.indexOf(game.phase)) + 1;
  const started = Date.parse(game.createdAt);
  const minutesElapsed = Number.isFinite(started)
    ? Math.max(0, Math.round((nowMs - started) / 60000))
    : 0;

  // What the plan says should be gone by the time this chapter is underway.
  const minutesExpected = minutesBefore(game.phase) + PHASE_MINUTES[game.phase];

  // A five-minute grace before anyone is told they are late; a host who is
  // nagged from minute one stops reading the indicator at all.
  const state: Pacing['state'] =
    minutesElapsed > minutesExpected + 5
      ? 'behind'
      : minutesElapsed < minutesExpected - 5
        ? 'ahead'
        : 'on-time';

  return {
    chapter,
    chapterCount: GAME_PHASES.length,
    cardsPlayed: usedCardIds.length,
    cardsPlanned: PLANNED_CARDS,
    minutesElapsed,
    minutesTarget: TARGET_MINUTES,
    minutesExpected,
    state,
    fraction: Math.min(1, (chapter - 1) / (GAME_PHASES.length - 1)),
  };
}
