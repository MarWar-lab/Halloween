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

/**
 * The only ledger fact this file is allowed to read: who published a
 * fragment, and how many. Nothing about which berth, which rule, or who
 * held one and never posted — a fragment nobody published stays exactly as
 * invisible in the debrief as it was all night. That silence is the seal
 * working, not a gap in this prompt.
 */
export interface LedgerActivity {
  puzzles: { posted: { playerId: string }[] }[];
  nameOf: (playerId: string) => string | undefined;
}

/**
 * What this file is allowed to read about teams: who is on which one, and
 * everyone's ruthless mark count — both already public at `result`, the
 * same gate the ledger prompt and every answer-based prompt above already
 * wait behind. Nothing about anyone's survival odds: those never become
 * public at any phase, individually or aggregated, and a team prompt that
 * needed them would not be buildable from data this file is allowed to see.
 */
export interface TeamActivity {
  teams: { id: string; memberIds: string[] }[];
  ruthless: { playerId: string; marks: number }[];
  nameOf: (playerId: string) => string | undefined;
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
 * Up to three prompts built from the real spread of this game's answers,
 * plus a fourth — who fed the Exchange the most — when `ledger` is passed,
 * plus a fifth — which team went furthest together — when `team` is passed.
 * Empty if there is nothing worth reading: too few real (non-auto) answers
 * for the first three, nobody published anything for the fourth, and no
 * team carries a mark for the fifth.
 */
export function buildDebrief(answers: Answer[], ledger?: LedgerActivity, team?: TeamActivity): DebriefPrompt[] {
  // A "split" or "unanimous" reading needs at least two real choices to
  // compare — one player can't disagree with themselves.
  const rounds = QUESTIONS.map((_, i) => tally(answers, i)).filter((r) => r.total > 1);
  const prompts: DebriefPrompt[] = [];

  // The three prompts below all need at least two real answers on the same
  // round to compare — the ledger prompt is independent data (who published,
  // not who answered what) and must not be gated on it: a quiet round of
  // questions and a busy Exchange can both be true of the same night.
  if (rounds.length > 0) {
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
        // Reframed, not just reworded: the earlier version ("worth asking
        // what was going through their head") reads as a verdict on
        // whoever chose it. This game cannot honestly say the dark option
        // was the round's best odds — the percentages behind every choice
        // are sealed permanently, not just before the tribunal, so no
        // debrief prompt may ever compare them — but it can say plainly
        // that "coldest" and "safest-feeling in the moment" are not the
        // same thing, which is the point either way: the system built the
        // temptation, the choice was still real.
        body: `${darkest.darkCount} of ${darkest.r.total} took the coldest option on the table — it often `
          + 'reads as the safer bet in the moment, not the crueller one. Worth asking what made it feel '
          + 'that way, not just why they took it.',
      });
    }
  }

  // A fourth slot, additive rather than competing with the three above —
  // generosity across teams is the newest thing this night is actually
  // about, and it should not have to displace a round that split the room.
  const ledgerPrompt = ledger && buildLedgerPrompt(ledger);
  if (ledgerPrompt) prompts.push(ledgerPrompt);

  // A fifth, same reasoning: which team went furthest together, additive
  // rather than competing with anything above.
  const teamPrompt = team && buildTeamPrompt(team);
  if (teamPrompt) prompts.push(teamPrompt);

  const cap = 3 + (ledger ? 1 : 0) + (team ? 1 : 0);
  return prompts.slice(0, cap);
}

/**
 * Who published the most fragments to the Exchange — the one piece of
 * cross-team behaviour this game can name without unsealing anything,
 * because publishing is the one thing that was never private in the first
 * place.
 */
function buildLedgerPrompt(ledger: LedgerActivity): DebriefPrompt | null {
  const counts = new Map<string, number>();
  for (const puzzle of ledger.puzzles) {
    for (const post of puzzle.posted) counts.set(post.playerId, (counts.get(post.playerId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const name = ledger.nameOf(topId);
  if (!name || topCount === 0) return null;

  return {
    title: 'Who fed the ledger',
    body: `${name} published ${topCount} fragment${topCount === 1 ? '' : 's'} to the room — more than anyone `
      + 'else. Every one of those helped whoever was racing them for a seat. Worth asking what that cost.',
  };
}

/**
 * Which team carries the most ruthless marks between its members. Safe to
 * compute from a single representative mark count per team, because
 * consensus mode means every member of a team shares one tap on every
 * question — but `Math.max` across members is used anyway, defensively, so
 * a team that somehow split (a late joiner dealt in mid-game, say) is still
 * read by its most-marked member rather than an arbitrary one.
 */
function buildTeamPrompt(activity: TeamActivity): DebriefPrompt | null {
  if (activity.teams.length < 2) return null;

  const teamMarks = activity.teams.map((team) => {
    const marks = team.memberIds.map((id) => activity.ruthless.find((r) => r.playerId === id)?.marks ?? 0);
    return { team, marks: marks.length > 0 ? Math.max(...marks) : 0 };
  });
  const highest = [...teamMarks].sort((a, b) => b.marks - a.marks)[0];
  if (!highest || highest.marks === 0) return null;

  const names = highest.team.memberIds.map((id) => activity.nameOf(id)).filter((n): n is string => !!n);
  if (names.length === 0) return null;

  return {
    title: 'The team that went furthest',
    body: `${names.join(', ')} carry ${highest.marks} ${highest.marks === 1 ? 'mark' : 'marks'} between them — `
      + "every one of you shared that call, since a team's tap decides it for everyone on it. Worth asking how "
      + 'it felt to carry that together.',
  };
}
