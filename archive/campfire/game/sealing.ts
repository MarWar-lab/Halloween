/**
 * What each viewer is allowed to see, by round phase.
 *
 * This mirrors the policies and the `round_submissions` function in
 * supabase/migrations. It exists as a pure function so the rule can be tested
 * without a database, and so the local backend cannot drift into being more
 * permissive than the real one — testing against a leaky imitation would give
 * false confidence in the one mechanic that depends on secrecy.
 *
 * There are two separate secrets here, and they lift at different moments:
 * the *text* of an answer opens at the reveal, and its *author* stays hidden
 * until the round is scored. Conflating them is the easy mistake, and it
 * quietly destroys both all-play and guess-who.
 */

import type { RoundPhase, Submission, Vote } from './types';

/**
 * Who this viewer counts as.
 *
 * Usually one player. For a host running people without devices it is the
 * host plus every proxy they operate: the host typed those answers, so
 * hiding the authorship back from them tells them nothing they do not know
 * and stops the console from working out which answer a proxy must not vote
 * for.
 */
export type Viewer = string | null | readonly string[];

const owns = (viewer: Viewer, playerId: string | null): boolean =>
  playerId != null &&
  (Array.isArray(viewer) ? viewer.includes(playerId) : viewer === playerId);

/**
 * Answers are sealed while people are still writing them, and open from the
 * reveal onwards. `voting` belongs here: you cannot vote on what you cannot
 * read.
 */
export const SUBMISSIONS_VISIBLE_IN: RoundPhase[] = ['revealing', 'voting', 'scored'];

/** Authorship is the last thing to open, and it opens all at once. */
export const AUTHORS_VISIBLE_IN: RoundPhase[] = ['scored'];

/**
 * Votes stay hidden a phase longer than answers — until scoring — so nobody
 * can watch a tally build up and pile onto the leader.
 */
export const VOTES_VISIBLE_IN: RoundPhase[] = ['scored'];

/**
 * Strip the author from everyone else's answers until the round is scored.
 * Your own row keeps its id, so a player can always find their own answer in
 * the list and be prevented from voting for it.
 */
export function anonymise(
  submissions: Submission[],
  phase: RoundPhase,
  viewer: Viewer,
): Submission[] {
  if (AUTHORS_VISIBLE_IN.includes(phase)) return submissions;
  return submissions.map((s) => (owns(viewer, s.playerId) ? s : { ...s, playerId: null }));
}

export function visibleSubmissions(
  submissions: Submission[],
  phase: RoundPhase,
  viewer: Viewer,
): Submission[] {
  const mine = submissions.filter((s) => owns(viewer, s.playerId));
  if (!SUBMISSIONS_VISIBLE_IN.includes(phase)) return mine;
  return anonymise(submissions, phase, viewer);
}

export function visibleVotes(votes: Vote[], phase: RoundPhase, viewer: Viewer): Vote[] {
  if (VOTES_VISIBLE_IN.includes(phase)) return votes;
  return votes.filter((v) => owns(viewer, v.voterId));
}
