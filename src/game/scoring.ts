/**
 * Scoring. Pure functions only — no Supabase, no React, no clock.
 *
 * These mirror the SQL in supabase/migrations. The server is authoritative;
 * these exist so the client can preview a result instantly, and so the rules are
 * unit-testable without a database. If you change a rule, change both.
 *
 * One rule is load-bearing and must never be quietly relaxed: spending a Pass
 * costs zero points. If passing costs anything, the quiet half of the team reads
 * it as a trap and stops using it — which defeats the entire design.
 */

import type { RoundResults, Submission, Vote } from './types';

/**
 * Median, not mean. A single troll voting 1 and a single loyalist voting 5
 * cannot move a median, and in a work game both of those show up every time.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Drop votes that shouldn't count: the performer scoring themselves, and any
 * second vote from the same person.
 *
 * This is for the one-vote-per-person mechanics. Guess-who is not one of them —
 * there a player guesses once per answer — so it uses `guessesPerVoter` below.
 * Running guess-who through here silently discarded every guess but the first,
 * which made a whole mechanic look like it scored zero.
 */
export function validVotes(votes: Vote[], performerId?: string | null): Vote[] {
  const seen = new Set<string>();
  const out: Vote[] = [];
  for (const v of votes) {
    if (seen.has(v.voterId)) continue;
    if (performerId && v.voterId === performerId) continue;
    seen.add(v.voterId);
    out.push(v);
  }
  return out;
}

/**
 * Guess-who votes: at most one guess per voter *per answer*, latest wins, and
 * never a guess on your own answer.
 */
export function guessesPerVoter(votes: Vote[]): Vote[] {
  const byPair = new Map<string, Vote>();
  for (const v of votes) {
    if (!v.targetPlayerId || !v.guessPlayerId) continue;
    if (v.voterId === v.targetPlayerId) continue;
    byPair.set(`${v.voterId}::${v.submissionId ?? v.targetPlayerId}`, v);
  }
  return [...byPair.values()];
}

/**
 * Solo turn: peers score the performance 1-5, the median becomes points.
 * A performance nobody scored is worth nothing rather than a default — silence
 * is information, and inventing points for it would flatter the scoreboard.
 */
export function scoreSolo(performerId: string, votes: Vote[]): RoundResults {
  const scores = validVotes(votes, performerId)
    .map((v) => v.score)
    .filter((s): s is number => typeof s === 'number');

  const points = Math.round(median(scores));
  return {
    points: { [performerId]: points },
    notes: scores.length
      ? { [performerId]: `median ${median(scores)} from ${scores.length} votes` }
      : { [performerId]: 'no votes cast' },
  };
}

/**
 * All-play: everyone answered, answers were revealed unattributed, everyone
 * voted for their favourite. Two points per vote received, and one point for
 * simply submitting — showing up is worth something, and it keeps a shy player
 * who wrote something plain from ending the round on zero.
 */
export function scoreAllplay(submissions: Submission[], votes: Vote[]): RoundResults {
  const points: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const authors: Record<string, string> = {};

  // Scoring always runs against unmasked rows on the server; a null author
  // here would mean the caller passed it a player's censored view by mistake.
  const authorOf = new Set<string>();
  for (const s of submissions) {
    if (!s.playerId) continue;
    authorOf.add(s.playerId);
    authors[s.id] = s.playerId;
    points[s.playerId] = 1;
  }

  const tally: Record<string, number> = {};
  for (const v of validVotes(votes)) {
    if (!v.targetPlayerId) continue;
    // A vote for yourself is discarded rather than rejected at the UI, because
    // proxy votes are entered by the host and typos happen.
    if (v.targetPlayerId === v.voterId) continue;
    if (!authorOf.has(v.targetPlayerId)) continue;
    tally[v.targetPlayerId] = (tally[v.targetPlayerId] ?? 0) + 1;
  }

  for (const [playerId, count] of Object.entries(tally)) {
    points[playerId] = (points[playerId] ?? 0) + count * 2;
    notes[playerId] = `${count} vote${count === 1 ? '' : 's'}`;
  }

  return { points, authors, notes };
}

/**
 * Guess-who: each submission is a private fact. Players guess the author.
 * Two points for a correct guess; one point to the author for every player they
 * fooled. Both halves matter, so a boring-but-unguessable fact and a wild-but-
 * obvious one score differently.
 */
export function scoreGuessWho(submissions: Submission[], votes: Vote[]): RoundResults {
  const points: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const authors: Record<string, string> = {};

  for (const s of submissions) {
    if (!s.playerId) continue;
    authors[s.id] = s.playerId;
    points[s.playerId] = points[s.playerId] ?? 0;
  }

  const fooled: Record<string, number> = {};
  for (const v of guessesPerVoter(votes)) {
    // targetPlayerId carries the true author of the submission being guessed;
    // the server resolves it, because the voter is never told it.
    // guessesPerVoter has already dropped anything with a missing author.
    const author = v.targetPlayerId as string;
    if (v.guessPlayerId === author) {
      points[v.voterId] = (points[v.voterId] ?? 0) + 2;
    } else {
      fooled[author] = (fooled[author] ?? 0) + 1;
    }
  }

  for (const [authorId, count] of Object.entries(fooled)) {
    points[authorId] = (points[authorId] ?? 0) + count;
    notes[authorId] = `fooled ${count}`;
  }

  return { points, authors, notes };
}

/** Duel: the room picks between two players. Three to the winner, one for showing up. */
export function scoreDuel(aId: string, bId: string, votes: Vote[]): RoundResults {
  let a = 0;
  let b = 0;
  for (const v of validVotes(votes)) {
    if (v.targetPlayerId === aId) a += 1;
    if (v.targetPlayerId === bId) b += 1;
  }

  const points: Record<string, number> = { [aId]: 1, [bId]: 1 };
  const notes: Record<string, string> = { [aId]: `${a} votes`, [bId]: `${b} votes` };

  if (a > b) points[aId] += 3;
  else if (b > a) points[bId] += 3;
  else {
    // A draw splits the prize rather than going to sudden death. Sudden death is
    // fun with two extroverts and miserable with anyone else.
    points[aId] += 1;
    points[bId] += 1;
    notes[aId] = notes[bId] = `${a} all — drawn`;
  }

  return { points, notes };
}

/**
 * Split: two options, one tap each.
 *
 * A point for answering, and two more for landing on the smaller side. The
 * reward goes to the minority on purpose — a party game should pay people for
 * answering honestly when their answer is odd, not for guessing where the room
 * already is. A dead heat pays everyone the bonus, because a room split down
 * the middle is the best possible outcome of a question like this.
 */
export function scoreSplit(votes: Vote[]): RoundResults {
  const points: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const counted = validVotes(votes).filter(
    (v) => v.optionIndex === 0 || v.optionIndex === 1,
  );

  const tally = [0, 0];
  for (const v of counted) tally[v.optionIndex as number] += 1;
  for (const v of counted) points[v.voterId] = 1;

  if (counted.length === 0) return { points, notes };

  const drawn = tally[0] === tally[1];
  const smaller = tally[0] < tally[1] ? 0 : 1;
  for (const v of counted) {
    if (drawn || v.optionIndex === smaller) {
      points[v.voterId] += 2;
      notes[v.voterId] = drawn ? 'split down the middle' : 'with the few';
    }
  }
  return { points, notes };
}

/** How a split round came out, for the screen to draw. */
export const splitTally = (votes: Vote[]): [number, number] => {
  const tally: [number, number] = [0, 0];
  for (const v of validVotes(votes)) {
    if (v.optionIndex === 0 || v.optionIndex === 1) tally[v.optionIndex] += 1;
  }
  return tally;
};

/**
 * Poll: everybody names a person, and the count is the result.
 *
 * There is no second vote, because there is nothing left to decide — the
 * tally already said it. Three points to whoever the room named, one to
 * everyone who answered, and one more to those who read the room correctly.
 * A tie names both.
 */
export function scorePoll(votes: Vote[]): RoundResults {
  const points: Record<string, number> = {};
  const notes: Record<string, string> = {};
  const counted = validVotes(votes).filter((v) => v.targetPlayerId);

  const tally: Record<string, number> = {};
  for (const v of counted) {
    points[v.voterId] = (points[v.voterId] ?? 0) + 1;
    tally[v.targetPlayerId as string] = (tally[v.targetPlayerId as string] ?? 0) + 1;
  }

  const top = Math.max(0, ...Object.values(tally));
  if (top === 0) return { points, notes };

  const winners = Object.keys(tally).filter((id) => tally[id] === top);
  for (const id of winners) {
    points[id] = (points[id] ?? 0) + 3;
    notes[id] = `named by ${top}`;
  }
  for (const v of counted) {
    if (winners.includes(v.targetPlayerId as string)) points[v.voterId] += 1;
  }
  return { points, notes };
}

/** How a poll came out, most-named first. */
export const pollTally = (votes: Vote[]): { playerId: string; count: number }[] => {
  const tally: Record<string, number> = {};
  for (const v of validVotes(votes)) {
    if (v.targetPlayerId) tally[v.targetPlayerId] = (tally[v.targetPlayerId] ?? 0) + 1;
  }
  return Object.entries(tally)
    .map(([playerId, count]) => ({ playerId, count }))
    .sort((a, b) => b.count - a.count);
};

/** Merge a round's points into running totals. */
export function applyResults(
  totals: Record<string, number>,
  results: RoundResults,
): Record<string, number> {
  const next = { ...totals };
  for (const [playerId, pts] of Object.entries(results.points)) {
    next[playerId] = (next[playerId] ?? 0) + pts;
  }
  return next;
}
