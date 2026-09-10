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

/** Drop votes that shouldn't count: self-votes, and duplicates per voter. */
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

  const authorOf = new Map<string, string>();
  for (const s of submissions) {
    authorOf.set(s.playerId, s.playerId);
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

  for (const s of submissions) points[s.playerId] = points[s.playerId] ?? 0;

  const fooled: Record<string, number> = {};
  for (const v of validVotes(votes)) {
    if (!v.guessPlayerId || !v.targetPlayerId) continue;
    // targetPlayerId carries the true author of the submission being guessed.
    if (v.guessPlayerId === v.targetPlayerId) {
      points[v.voterId] = (points[v.voterId] ?? 0) + 2;
    } else {
      fooled[v.targetPlayerId] = (fooled[v.targetPlayerId] ?? 0) + 1;
    }
  }

  for (const [authorId, count] of Object.entries(fooled)) {
    points[authorId] = (points[authorId] ?? 0) + count;
    notes[authorId] = `fooled ${count}`;
  }

  return { points, notes };
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
