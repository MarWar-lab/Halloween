/**
 * The facilitator debrief — discussion prompts drawn from what the room
 * actually did, not a fixed script.
 *
 * Nothing here reads a secret. `Answer.playerId` is already public once a
 * question is revealed (see the comment on `Answer` in types.ts), and by
 * `result` every question has been — this is just that same public data,
 * added up across all nine rounds instead of one at a time, the way the
 * live reveal tally already does for whichever round is on screen.
 *
 * An auto-assigned answer (silence, or a late join) is excluded from every
 * tally here, for the same reason `marksOf` excludes it from a ruthless
 * count: it was never a real decision, so it should not read as one in a
 * room discussion either.
 */

import type { Answer } from './types';
import { DARK_CHOICES, QUESTIONS } from './questions';

export interface DebriefPrompt {
  title: string;
  body: string;
}

interface RoundTally {
  questionIdx: number;
  counts: number[];
  total: number;
}

function tally(answers: Answer[], questionIdx: number): RoundTally {
  const counts = [0, 0, 0, 0, 0];
  for (const a of answers) {
    if (a.questionIdx === questionIdx && !a.autoAssigned) counts[a.optionIndex] += 1;
  }
  return { questionIdx, counts, total: counts.reduce((sum, c) => sum + c, 0) };
}

/** The share of the room that landed on its most popular option — 1 is unanimous. */
const agreement = (r: RoundTally): number => Math.max(...r.counts) / r.total;

/**
 * Up to three prompts, built from the real spread of this game's answers.
 * Empty if there is nothing worth reading — too few real (non-auto) answers
 * to say anything true about the room.
 */
export function buildDebrief(answers: Answer[]): DebriefPrompt[] {
  // A "split" or "unanimous" reading needs at least two real choices to
  // compare — one player can't disagree with themselves.
  const rounds = QUESTIONS.map((_, i) => tally(answers, i)).filter((r) => r.total > 1);
  if (rounds.length === 0) return [];

  const prompts: DebriefPrompt[] = [];

  const mostSplit = [...rounds].sort((a, b) => agreement(a) - agreement(b))[0];
  if (agreement(mostSplit) < 1) {
    const q = QUESTIONS[mostSplit.questionIdx];
    const lead = Math.max(...mostSplit.counts);
    prompts.push({
      title: `Where you split hardest — ${q.title}`,
      body: `No more than ${lead} of ${mostSplit.total} of you landed on the same call. Ask the room why.`,
    });
  }

  const mostUnanimous = [...rounds].sort((a, b) => agreement(b) - agreement(a))[0];
  if (agreement(mostUnanimous) === 1 && mostUnanimous.questionIdx !== mostSplit.questionIdx) {
    const q = QUESTIONS[mostUnanimous.questionIdx];
    prompts.push({
      title: `Where you all agreed — ${q.title}`,
      body: 'Every one of you made the same call. Ask if anyone almost went a different way.',
    });
  }

  const darkest = rounds
    .map((r) => ({
      r,
      darkCount: (DARK_CHOICES[r.questionIdx] ?? []).reduce((sum, i) => sum + r.counts[i], 0),
    }))
    .filter((x) => x.darkCount > 0)
    .sort((a, b) => b.darkCount - a.darkCount)[0];
  if (darkest) {
    const q = QUESTIONS[darkest.r.questionIdx];
    prompts.push({
      title: `The hardest call — ${q.title}`,
      body: `${darkest.darkCount} of ${darkest.r.total} took the coldest option on the table. Worth asking what was going through their head.`,
    });
  }

  return prompts.slice(0, 3);
}
