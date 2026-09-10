/**
 * The list of answers, numbered the same way for everyone.
 *
 * This exists because it was not. The Stage numbered from every answer, while
 * each phone numbered from a list with its own author's answer removed — so
 * with four answers and yours second, the shared screen showed 1 2 3 4 and
 * your phone showed 1 2 3 pointing at the Stage's 1, 3 and 4. The host reads
 * "number three" aloud and half the room votes for something else. Nothing
 * caught it because no test compared the two screens.
 *
 * One function now produces the numbering for all three views. Your own answer
 * keeps its number and is marked `mine` rather than dropped, which is what
 * keeps the numbers aligned.
 */

import type { Round, Submission, Vote } from './types';

export interface Choice {
  submission: Submission;
  /** 1-based, and identical on every screen in the room. */
  number: number;
  /** True for the viewer's own answer: shown, numbered, never votable. */
  mine: boolean;
}

/**
 * A stable order, independent of arrival.
 *
 * `created_at` alone is not enough: two answers submitted in the same
 * millisecond can come back in either order, and then two clients number them
 * differently — the same bug again, appearing only under the load of everyone
 * answering at once.
 */
export function orderedSubmissions(submissions: Submission[]): Submission[] {
  return [...submissions].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function choicesFor(submissions: Submission[], viewerPlayerId: string | null): Choice[] {
  return orderedSubmissions(submissions).map((submission, i) => ({
    submission,
    number: i + 1,
    mine: viewerPlayerId != null && submission.playerId === viewerPlayerId,
  }));
}

/** What this viewer may actually vote for. */
export const votableChoices = (choices: Choice[]): Choice[] => choices.filter((c) => !c.mine);

/**
 * One voter's ballot, in a shape that suits every mechanic.
 *
 * The views previously each indexed `[0]` into a filtered vote array, which is
 * right for the one-vote mechanics and wrong for guess-who, where a player
 * casts one vote per answer.
 */
export interface Ballot {
  /** solo: the 1-5 they gave. */
  score: number | null;
  /** duel: who they sided with. */
  targetPlayerId: string | null;
  /** allplay: the answer they picked. */
  submissionId: string | null;
  /** guesswho: submission id → who they think wrote it. */
  guesses: Record<string, string>;
}

export function myBallot(votes: Vote[], voterId: string | null): Ballot {
  const mine = votes.filter((v) => v.voterId === voterId);
  const guesses: Record<string, string> = {};
  for (const v of mine) {
    if (v.submissionId && v.guessPlayerId) guesses[v.submissionId] = v.guessPlayerId;
  }
  const first = mine[0];
  return {
    score: first?.score ?? null,
    targetPlayerId: first?.targetPlayerId ?? null,
    submissionId: first?.submissionId ?? null,
    guesses,
  };
}

/**
 * Who is expected to act this round.
 *
 * The performer does not score their own turn and the duellists do not vote in
 * their own duel, so they are not "late" — counting them makes the host wait
 * for people who are not allowed to answer. This was derived separately in
 * three places, each slightly differently.
 */
export function eligibleVoters<T extends { id: string }>(round: Round | null, players: T[]): T[] {
  if (!round) return players;
  const excused = new Set([round.turnPlayerId, round.opponentId].filter(Boolean) as string[]);
  return players.filter((p) => !excused.has(p.id));
}
