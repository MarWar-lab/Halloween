/**
 * Which clips are worth warming the cache for, and when.
 *
 * Pure and DOM-free on purpose, same reason `tensionInputFromSnapshot` is
 * split from `computeTension`: the actual `document.head.appendChild` side
 * effect belongs in a hook (`useClipPrefetch.ts`) and cannot be unit-tested
 * without a DOM this project doesn't carry — but the DECISION of what to
 * warm and when is ordinary logic, and deserves real coverage.
 *
 * Two moments, matched to when bandwidth is genuinely idle rather than
 * competing with something the room is waiting on:
 *
 *  - the whole set, once, at the briefing — the room is reading two long
 *    passages and hasn't tapped anything yet.
 *  - the very next question's clip, during a reveal — five outcomes take a
 *    while to read, which is exactly the window before the host advances.
 */

import { QUESTIONS } from './questions';

/** Every clip in the game, in question order. Called once, at the briefing. */
export function allClipUrls(): string[] {
  return QUESTIONS.flatMap((q) => (q.clip ? [q.clip] : []));
}

/**
 * The one clip worth warming right now, given a just-opened reveal — or
 * null when there isn't a next question, or it carries no clip of its own.
 */
export function nextClipUrl(questionIdx: number): string | null {
  return QUESTIONS[questionIdx + 1]?.clip ?? null;
}
