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

    if (p.passSpent && state !== 'speaking' && state !== 'winner') state = 'passed';

    return {
      id: p.id,
      name: p.name,
      look: p.look,
      state,
      away: !p.isProxy && !present.has(p.id),
    };
  });
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
