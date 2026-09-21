/**
 * Holding the night to something a calendar invite can promise.
 *
 * Survival has never had a clock of any kind — no target, no per-question
 * budget, and thirteen beats that only move when the host taps. Campfire
 * learned this the expensive way and carries `src/game/pacing.ts`; this is
 * the same idea against a different shape of evening, and it matters more
 * here now that the puzzles add a negotiation whose length is set by the room
 * rather than by the script.
 *
 * Everything is derived from three facts already on the snapshot — when the
 * game was created, which phase it is in, and which question — so it needs no
 * new columns and behaves identically on both backends.
 */

import { targetMinutesFor } from './scale';
import type { Phase } from './types';
import { INTRO_QUESTIONS, QUESTIONS } from './questions';

/** Phase order, which is otherwise only written down inside `survival_advance`. */
export const PHASES: Phase[] = ['lobby', 'briefing', 'running', 'plea', 'tribunal', 'result'];

/**
 * Minutes budgeted per phase at the reference room size of eight, before
 * `targetMinutesFor` stretches the whole thing for a bigger one.
 *
 * `running` is not a flat block — it is eleven beats of very different cost,
 * so it is budgeted per question below and this entry is their sum.
 */
export const PHASE_MINUTES: Record<Phase, number> = {
  lobby: 5,
  briefing: 3,
  running: 30,
  plea: 4,
  tribunal: 2,
  result: 1,
};

/** A warm-up is a laugh and a tap. It is not supposed to cost what a real round does. */
export const WARMUP_MINUTES = 1.5;

/** Read it, argue about it, tap, watch the reveal, argue about that. */
export const QUESTION_MINUTES = 3;

/**
 * How far into `running` the room should be by the time it reaches a given
 * question index. Negative indices are the warm-ups, counting back from -1,
 * exactly as `questionAt` reads them.
 */
export function minutesIntoRunning(questionIdx: number): number {
  const warmupsDone = Math.min(INTRO_QUESTIONS.length, INTRO_QUESTIONS.length + questionIdx);
  const questionsDone = Math.max(0, questionIdx);
  return warmupsDone * WARMUP_MINUTES + questionsDone * QUESTION_MINUTES;
}

/** Minutes the plan says are gone by the time a phase begins. */
export function minutesBefore(phase: Phase): number {
  let total = 0;
  for (const p of PHASES) {
    if (p === phase) break;
    total += PHASE_MINUTES[p];
  }
  return total;
}

export interface Pacing {
  /** 1-based, for "beat 7 of 15". Counts questions individually, not phases. */
  beat: number;
  beatCount: number;
  minutesElapsed: number;
  /** What this room size was promised, door to door. */
  minutesTarget: number;
  /** What the plan says should be gone by now. */
  minutesExpected: number;
  /**
   * How the night is running. `behind` is the one that matters: it is the cue
   * to stop letting a reveal breathe and move the question on.
   */
  state: 'ahead' | 'on-time' | 'behind';
  /** 0-1, for a bar. Clamped, because a long night should not overflow it. */
  fraction: number;
}

/**
 * A five-minute grace before anybody is told they are late.
 *
 * Campfire found that a host nagged from minute one stops reading the
 * indicator at all, which is worse than not having one.
 */
const GRACE_MINUTES = 5;

export function pacingFor(
  game: { phase: Phase; questionIdx: number; createdAt: string },
  playerCount: number,
  nowMs = Date.now(),
): Pacing {
  const started = Date.parse(game.createdAt);
  const minutesElapsed = Number.isFinite(started)
    ? Math.max(0, Math.round((nowMs - started) / 60000))
    : 0;

  const planned =
    game.phase === 'running'
      ? minutesBefore('running') + minutesIntoRunning(game.questionIdx) + QUESTION_MINUTES
      : minutesBefore(game.phase) + PHASE_MINUTES[game.phase];

  // The per-phase budget is written for a room of eight. A bigger room is
  // promised more time, so the expectation has to stretch by the same factor
  // or a twenty-person game reads "behind" from the lobby onward.
  const reference = Object.values(PHASE_MINUTES).reduce((a, b) => a + b, 0);
  const minutesTarget = targetMinutesFor(playerCount);
  const minutesExpected = Math.round((planned * minutesTarget) / reference);

  const state: Pacing['state'] =
    minutesElapsed > minutesExpected + GRACE_MINUTES
      ? 'behind'
      : minutesElapsed < minutesExpected - GRACE_MINUTES
        ? 'ahead'
        : 'on-time';

  // Beats: lobby, briefing, every warm-up and question, then the three
  // closing phases. Counted individually because "phase 3 of 6" spends most
  // of the night saying 3.
  const beatCount = 2 + INTRO_QUESTIONS.length + QUESTIONS.length + 3;
  const beat =
    game.phase === 'running'
      ? 2 + INTRO_QUESTIONS.length + game.questionIdx + 1
      : PHASES.indexOf(game.phase) < PHASES.indexOf('running')
        ? PHASES.indexOf(game.phase) + 1
        : 2 + INTRO_QUESTIONS.length + QUESTIONS.length + (PHASES.indexOf(game.phase) - 2);

  return {
    beat,
    beatCount,
    minutesElapsed,
    minutesTarget,
    minutesExpected,
    state,
    fraction: Math.min(1, Math.max(0, (beat - 1) / (beatCount - 1))),
  };
}
