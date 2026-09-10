/**
 * The rule under test is a product rule, not an implementation detail: if it
 * is not your move you get no controls. It is asserted exhaustively because
 * the failure mode is silent — an extra button that does nothing reads as a
 * broken game, and only the person holding the phone ever sees it.
 */

import { describe, expect, it } from 'vitest';
import { hasSomethingToDo, turnFor } from './turn';
import { roundFlow } from './machine';
import { halloween } from './themes';
import { deckById } from './decks';
import type { Mechanic, Player, Round, RoundPhase } from './types';

const deck = deckById('halloween');

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  gameId: 'g',
  userId: id,
  name: id,
  look: { body: 0, topper: 0, top: 0, accessory: 0 },
  isProxy: false,
  controlledBy: null,
  score: 0,
  passSpent: false,
  lastSeen: '',
  ...over,
});

const players = [player('ana'), player('ben'), player('cleo')];

const round = (mechanic: Mechanic, phase: RoundPhase, over: Partial<Round> = {}): Round => ({
  id: 'r',
  gameId: 'g',
  idx: 1,
  cardId: deck.cards.find((c) => c.mechanic === mechanic)!.id,
  mechanic,
  turnPlayerId: mechanic === 'solo' || mechanic === 'duel' ? 'ana' : null,
  opponentId: mechanic === 'duel' ? 'ben' : null,
  phase,
  deadlineAt: null,
  results: null,
  ...over,
});

const view = (r: Round | null, meId: string) =>
  turnFor({
    round: r,
    card: r ? (deck.cards.find((c) => c.id === r.cardId) ?? null) : null,
    me: players.find((p) => p.id === meId),
    submissions: [],
    submittedPlayerIds: [],
    votedPlayerIds: [],
    players,
    theme: halloween,
    inLobby: false,
  });

describe('what a player is asked to do', () => {
  it('always says something, at every phase of every mechanic', () => {
    for (const mechanic of ['solo', 'allplay', 'guesswho', 'duel'] as Mechanic[]) {
      for (const phase of roundFlow(mechanic)) {
        for (const me of players) {
          const v = view(round(mechanic, phase), me.id);
          expect(v.headline, `${mechanic}/${phase}/${me.id}`).toBeTruthy();
        }
      }
    }
  });

  it('gives the person being watched nothing to press', () => {
    // Someone performing needs the prompt and the clock. A control in front of
    // them is a distraction at the exact moment they are most exposed.
    for (const phase of ['choosing', 'performing'] as RoundPhase[]) {
      expect(hasSomethingToDo(view(round('solo', phase), 'ana').task)).toBe(false);
    }
  });

  it('gives the audience nothing to press while someone is performing', () => {
    for (const phase of ['choosing', 'performing'] as RoundPhase[]) {
      for (const bystander of ['ben', 'cleo']) {
        expect(hasSomethingToDo(view(round('solo', phase), bystander).task)).toBe(false);
      }
    }
  });

  it('never lets you score your own turn or your own duel', () => {
    expect(view(round('solo', 'voting'), 'ana').task.kind).toBe('idle');
    expect(view(round('duel', 'voting'), 'ana').task.kind).toBe('idle');
    expect(view(round('duel', 'voting'), 'ben').task.kind).toBe('idle');
    expect(view(round('duel', 'voting'), 'cleo').task.kind).toBe('sideWithOne');
  });

  it('asks everyone at once during an all-play, which is the point of it', () => {
    for (const me of players) {
      expect(view(round('allplay', 'submitting'), me.id).task.kind).toBe('write');
      expect(view(round('allplay', 'voting'), me.id).task.kind).toBe('pick');
    }
  });

  it('offers the Pass only to the person the card is actually asking', () => {
    expect(view(round('solo', 'choosing'), 'ana').canPass).toBe(true);
    expect(view(round('solo', 'choosing'), 'ben').canPass).toBe(false);
    // Nothing to pass out of when everyone answers at once.
    expect(view(round('allplay', 'submitting'), 'ana').canPass).toBe(false);
    // And never twice.
    const spent = turnFor({
      round: round('solo', 'choosing'),
      card: null,
      me: player('ana', { passSpent: true }),
      submissions: [],
      submittedPlayerIds: [],
      votedPlayerIds: [],
      players,
      theme: halloween,
      inLobby: false,
    });
    expect(spent.canPass).toBe(false);
  });

  it('does not leave a player staring at a blank screen between cards', () => {
    const v = view(null, 'ana');
    expect(v.headline).toBeTruthy();
    expect(v.detail).toBeTruthy();
    expect(hasSomethingToDo(v.task)).toBe(false);
  });
});
