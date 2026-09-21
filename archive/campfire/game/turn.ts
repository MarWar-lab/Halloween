/**
 * What one player should be doing, right now.
 *
 * Every "should this control be on screen?" decision in the player view comes
 * from here. Scattering those conditionals through JSX is how you end up
 * offering a vote button to the person being voted on, and how a player who
 * has nothing to do gets a screen full of controls that all do nothing.
 *
 * The rule this enforces: if it is not your move, you get no buttons. Not
 * disabled buttons — none. A disabled control still asks the reader to work
 * out why it is disabled, and on a phone during a work call nobody has the
 * attention to spare.
 */

import type { Card, Player, Round, RoundPhase, Submission } from './types';
import type { Theme } from './themes';

export type Task =
  /** Nothing to do. The screen says what the room is waiting for. */
  | { kind: 'idle' }
  /** Your turn is next; the host has not started the clock. */
  | { kind: 'brace' }
  /** You are performing out loud. No controls, just the prompt and the clock. */
  | { kind: 'perform' }
  /** Type a private answer. */
  | { kind: 'write'; hint: string }
  /** Score someone else's turn 1-5. */
  | { kind: 'rate' }
  /** Pick the answer you liked best. */
  | { kind: 'pick' }
  /** Say who you think wrote each answer. */
  | { kind: 'guess' }
  /** Choose between two duellists. */
  | { kind: 'sideWithOne' }
  /** Two options on the card. One tap and you are done. */
  | { kind: 'side'; options: [string, string] }
  /** Name a person. The count of names is the whole result. */
  | { kind: 'namePerson' }
  /** The round is over and you can see how it went. */
  | { kind: 'result' };

export interface TurnView {
  task: Task;
  /** The one line that tells the player what is happening. */
  headline: string;
  /** A second line, only where it earns its place. */
  detail?: string;
  /** Whether the Pass would do anything if pressed right now. */
  canPass: boolean;
}

interface Context {
  round: Round | null;
  card: Card | null;
  me: Player | undefined;
  submissions: Submission[];
  /** Player ids who have already answered — from the round, not the answers. */
  submittedPlayerIds: string[];
  votedPlayerIds: string[];
  players: Player[];
  theme: Theme;
  /** True before the first card of the evening. */
  inLobby: boolean;
}

const nameOf = (players: Player[], id: string | null | undefined) =>
  players.find((p) => p.id === id)?.name ?? 'someone';

export function turnFor(ctx: Context): TurnView {
  const { round, me, theme } = ctx;

  if (!me) return { task: { kind: 'idle' }, headline: 'Finding your seat…', canPass: false };

  if (ctx.inLobby) {
    return {
      task: { kind: 'idle' },
      headline: "You're in",
      detail: `${ctx.players.length} around the fire. The host starts it.`,
      canPass: false,
    };
  }

  if (!round) {
    return {
      task: { kind: 'idle' },
      headline: 'Next card coming up',
      detail: 'Nothing to do — watch the shared screen.',
      canPass: false,
    };
  }

  const isUp = round.turnPlayerId === me.id || round.opponentId === me.id;
  const performer = nameOf(ctx.players, round.turnPlayerId);

  // The Pass is only offered where it would change something: on a card that
  // is asking *you* personally, before it has been played. Offering it any
  // other time makes it look like a general escape hatch and then does
  // nothing when pressed.
  const canPass = !me.passSpent && isUp && round.phase !== 'scored';

  switch (round.phase as RoundPhase) {
    case 'choosing':
      return isUp
        ? {
            task: { kind: 'brace' },
            headline: "You're up next",
            detail: `Read the card. The host starts your clock when you're ready — or use your ${theme.vocab.pass}.`,
            canPass,
          }
        : {
            task: { kind: 'idle' },
            headline: `${performer} is up`,
            detail: 'Nothing to do yet. Watch, and be a good audience.',
            canPass: false,
          };

    case 'performing':
      if (isUp) {
        return {
          task: { kind: 'perform' },
          headline: 'Go — you have the room',
          detail: 'Say it out loud. Commitment scores higher than quality.',
          canPass,
        };
      }
      return {
        task: { kind: 'idle' },
        headline: round.opponentId
          ? `${performer} vs ${nameOf(ctx.players, round.opponentId)}`
          : `${performer} is going`,
        detail: 'Watch. You score it in a moment.',
        canPass: false,
      };

    case 'submitting': {
      const done = ctx.submittedPlayerIds.includes(me.id);
      return {
        task: { kind: 'write', hint: ctx.card?.submitHint ?? 'Your answer' },
        headline: done ? 'Answer sealed' : 'Everyone answers this one',
        detail: done
          ? `You can change it until the host closes answers. ${ctx.submittedPlayerIds.length} of ${ctx.players.length} in.`
          : 'Nobody sees it — not even the host — until the reveal.',
        canPass: false,
      };
    }

    case 'revealing':
      return {
        task: { kind: 'idle' },
        headline: 'Answers going up',
        detail: 'On the shared screen, with no names attached. Voting opens next.',
        canPass: false,
      };

    case 'voting': {
      const voted = ctx.votedPlayerIds.includes(me.id);

      if (round.mechanic === 'solo') {
        if (isUp) {
          return {
            task: { kind: 'idle' },
            headline: 'The room is scoring you',
            detail: "You can't score your own turn. Sit tight.",
            canPass: false,
          };
        }
        return {
          task: { kind: 'rate' },
          headline: `How did ${performer} do?`,
          detail: '1 is barely tried, 5 is fully committed.',
          canPass: false,
        };
      }

      if (round.mechanic === 'duel') {
        if (isUp) {
          return {
            task: { kind: 'idle' },
            headline: 'The room is picking',
            detail: "You can't vote in your own duel.",
            canPass: false,
          };
        }
        return { task: { kind: 'sideWithOne' }, headline: 'Who took it?', canPass: false };
      }

      if (round.mechanic === 'poll') {
        return {
          task: { kind: 'namePerson' },
          headline: ctx.card?.title ?? 'Name someone',
          detail: voted ? 'Tap another name to change your mind.' : 'One name. The count decides it.',
          canPass: false,
        };
      }

      if (round.mechanic === 'split') {
        const options = ctx.card?.options;
        if (!options) {
          return { task: { kind: 'idle' }, headline: 'Waiting for the card…', canPass: false };
        }
        return {
          task: { kind: 'side', options },
          headline: ctx.card?.title ?? 'Pick one',
          detail: voted ? 'Tap the other to change your mind.' : undefined,
          canPass: false,
        };
      }

      if (round.mechanic === 'guesswho') {
        return {
          task: { kind: 'guess' },
          headline: 'Whose is which?',
          detail: 'Two points for each one you get right.',
          canPass: false,
        };
      }

      // All-play. A player who never answered still votes — they just have
      // nothing of their own in the running.
      return {
        task: { kind: 'pick' },
        headline: 'Which one got you?',
        detail: voted ? 'Tap another to change your mind.' : 'You cannot pick your own.',
        canPass: false,
      };
    }

    case 'scored':
      return { task: { kind: 'result' }, headline: 'Round over', canPass: false };
  }
}

/**
 * True when the player view should render controls.
 *
 * `brace` and `perform` are deliberately false: the player is the one being
 * watched, and the only thing they may press is the Pass, which lives in the
 * footer and is governed by `canPass`.
 */
const PASSIVE: Task['kind'][] = ['idle', 'brace', 'perform', 'result'];

export const hasSomethingToDo = (task: Task): boolean => !PASSIVE.includes(task.kind);
