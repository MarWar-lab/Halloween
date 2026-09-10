/**
 * What each viewer is allowed to see, by round phase.
 *
 * This mirrors the `submissions_read` and `votes_read` policies in
 * supabase/migrations/0001_init.sql. It exists as a pure function so the rule
 * can be tested without a database, and so the local backend cannot drift into
 * being more permissive than the real one — testing against a leaky imitation
 * would give false confidence in the one mechanic that depends on secrecy.
 */

import type { RoundPhase, Submission, Vote } from './types';

/**
 * Answers are sealed while people are still writing them, and open from the
 * reveal onwards. `voting` belongs here: you cannot vote on what you cannot
 * read.
 */
export const SUBMISSIONS_VISIBLE_IN: RoundPhase[] = ['revealing', 'voting', 'scored'];

/**
 * Votes stay hidden a phase longer than answers — until scoring — so nobody
 * can watch a tally build up and pile onto the leader.
 */
export const VOTES_VISIBLE_IN: RoundPhase[] = ['scored'];

export function visibleSubmissions(
  submissions: Submission[],
  phase: RoundPhase,
  viewerPlayerId: string | null,
): Submission[] {
  if (SUBMISSIONS_VISIBLE_IN.includes(phase)) return submissions;
  return submissions.filter((s) => s.playerId === viewerPlayerId);
}

export function visibleVotes(
  votes: Vote[],
  phase: RoundPhase,
  viewerPlayerId: string | null,
): Vote[] {
  if (VOTES_VISIBLE_IN.includes(phase)) return votes;
  return votes.filter((v) => v.voterId === viewerPlayerId);
}
