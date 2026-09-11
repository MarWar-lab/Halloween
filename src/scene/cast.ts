/**
 * Turning game state into a scene.
 *
 * Shared by the Stage and the host console, which show the same fire — the
 * host should be looking at their own party, not at a form.
 */

import type { GameSnapshot } from '../net';
import type { SceneCharacter } from './Campfire';
import type { CharState } from './character';

/** Map game state onto what each character is doing. */
export function castFrom(
  snap: GameSnapshot,
  flashes: { id: number; emoji: string; playerId: string }[] = [],
): SceneCharacter[] {
  const round = snap.round;
  const present = new Set(snap.present);
  // The Stage has no seat, so every answer and every vote is sealed from it.
  // These lists are how it can still animate who has finished.
  const voted = new Set(snap.votedPlayerIds);
  const submitted = new Set(snap.submittedPlayerIds);
  const reactionStates = new Map<string, CharState>();
  for (const flash of flashes) {
    const state = stateForReaction(flash.emoji);
    if (state) reactionStates.set(flash.playerId, state);
  }

  const topScore = Math.max(0, ...snap.players.map((p) => p.score));

  return snap.players.map((p) => {
    let state: CharState = 'idle';

    if (round) {
      const isUp = round.turnPlayerId === p.id || round.opponentId === p.id;
      if (round.phase === 'performing' && isUp) state = 'speaking';
      else if (round.phase === 'performing') state = 'listening';
      else if (round.phase === 'submitting') state = submitted.has(p.id) ? 'ready' : 'thinking';
      else if (round.phase === 'choosing') state = isUp ? 'nervous' : 'listening';
      else if (round.phase === 'revealing') state = 'shocked';
      else if (round.phase === 'voting') state = voted.has(p.id) ? 'voting' : 'thinking';
      else if (round.phase === 'scored') {
        const pts = round.results?.points[p.id] ?? 0;
        state = pts >= 3 ? 'winner' : pts > 0 ? 'laughing' : 'applauding';
      }
    }

    if (snap.game.phase === 'awards' && p.score === topScore && topScore > 0) state = 'winner';
    else if (snap.game.phase === 'awards') state = 'applauding';

    const reactionState = reactionStates.get(p.id);
    if (reactionState && state !== 'speaking' && state !== 'winner') state = reactionState;

    // A Pass is spent once and remembered all night, so this used to leave a
    // player slumped for every remaining round — overwriting `ready` and
    // `voting`, which are exactly the postures the room reads to see who has
    // answered. It should only colour a player who is otherwise doing nothing.
    if (p.passSpent && (state === 'idle' || state === 'listening')) state = 'passed';

    // A badge, not a pose. Poses say what someone is doing; this says they are
    // done, and the two have to be sayable at the same time. It carries no
    // hint of *what* they said.
    const mark: SceneCharacter['mark'] =
      round?.phase === 'submitting' && submitted.has(p.id)
        ? 'sealed'
        : round?.phase === 'voting' && voted.has(p.id)
          ? 'voted'
          : null;

    // Sealed until scoring, exactly like every other vote.
    const side =
      round?.mechanic === 'split' && round.phase === 'scored'
        ? (snap.votes.find((v) => v.voterId === p.id)?.optionIndex as 0 | 1 | undefined) ?? null
        : null;

    return {
      id: p.id,
      name: p.name,
      look: p.look,
      state,
      side,
      mark,
      // Dim whoever the room is still waiting on, so "who are we waiting for"
      // is answerable in one glance across nine seats through a video codec.
      dim: waiting(round, p.id, submitted, voted),
      away: !p.isProxy && !present.has(p.id),
    };
  });
}

/** True while this round is still waiting on this player to act. */
function waiting(
  round: GameSnapshot['round'],
  playerId: string,
  submitted: Set<string>,
  voted: Set<string>,
): boolean {
  if (!round) return false;
  if (round.phase === 'submitting') return !submitted.has(playerId);
  if (round.phase === 'voting') {
    const excused = round.turnPlayerId === playerId || round.opponentId === playerId;
    return !excused && !voted.has(playerId);
  }
  return false;
}

/** The fire grows across the evening. By the finale it is a bonfire. */
export function fireScaleFor(phase: GameSnapshot['game']['phase']): number {
  switch (phase) {
    case 'lobby':
    case 'briefing':
      return 0.8;
    case 'warmup':
    case 'round1':
      return 1;
    case 'intermission':
    case 'round2':
      return 1.2;
    default:
      return 1.5;
  }
}

/** A reaction the room sent, mapped onto what a character does about it. */
function stateForReaction(emoji: string): CharState | null {
  switch (emoji) {
    case '😂':
    case '💀':
      return 'laughing';
    case '😱':
      return 'shocked';
    case '👏':
    case '🥁':
      return 'applauding';
    case '🫣':
    case '🌫️':
      return 'nervous';
    case '🔥':
    case '🕯️':
      return 'ready';
    default:
      return null;
  }
}
