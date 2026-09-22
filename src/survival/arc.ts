/**
 * How far into the night the room is, for the one thing this game has never
 * varied by round: how it looks.
 *
 * Three acts, roughly a third of the nine questions each, escalating into
 * the plea/tribunal/result close — never the lobby or briefing, which are
 * still safely before anything the room has actually done. Deliberately
 * coarse (three, not nine) — a value that changed every question would read
 * as flicker, not a mood settling in.
 */

import type { Phase } from './types';
import { QUESTIONS } from './questions';

export type Act = 1 | 2 | 3;

const ACT_SIZE = Math.ceil(QUESTIONS.length / 3);

export function actFor(phase: Phase, questionIdx: number): Act {
  if (phase === 'lobby' || phase === 'briefing') return 1;
  if (phase !== 'running') return 3;
  if (questionIdx < 0) return 1; // a warm-up
  if (questionIdx < ACT_SIZE) return 1;
  if (questionIdx < ACT_SIZE * 2) return 2;
  return 3;
}
