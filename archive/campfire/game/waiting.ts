import type { Round } from './types';

/**
 * How far the room has got with the card in play — the same sentence for the
 * host and for every phone.
 *
 * This lived inline in the host console, so the host could see "4 of 6
 * answered" while the players saw nothing at all. Three testers in a row sat
 * for over a minute after answering with no way to tell whether the game was
 * alive, waiting on them, or stuck. "Who has acted" is public by design — it
 * is what makes the round runnable — so there was never a reason to keep it on
 * one screen.
 *
 * Returns null outside a phase the room can be waiting on.
 */
export type RoomProgress = {
  /** e.g. "4 of 6 answered" */
  count: string;
  /** Names still to act, in player order. */
  who: string[];
  done: number;
  total: number;
};

export function roomProgress(
  players: readonly { id: string; name: string }[],
  submittedPlayerIds: readonly string[],
  votedPlayerIds: readonly string[],
  round: Round | null,
): RoomProgress | null {
  if (!round) return null;

  if (round.phase === 'submitting') {
    const done = players.filter((p) => submittedPlayerIds.includes(p.id));
    return {
      count: `${done.length} of ${players.length} answered`,
      who: players.filter((p) => !submittedPlayerIds.includes(p.id)).map((p) => p.name),
      done: done.length,
      total: players.length,
    };
  }

  if (round.phase === 'voting') {
    // Whoever is being scored does not vote on their own turn, so they are not
    // missing — counting them would leave the room waiting on someone who has
    // nothing to do.
    const excused = [round.turnPlayerId, round.opponentId].filter(Boolean) as string[];
    const eligible = players.filter((p) => !excused.includes(p.id));
    const done = eligible.filter((p) => votedPlayerIds.includes(p.id));
    return {
      count: `${done.length} of ${eligible.length} voted`,
      who: eligible.filter((p) => !votedPlayerIds.includes(p.id)).map((p) => p.name),
      done: done.length,
      total: eligible.length,
    };
  }

  return null;
}
