import { describe, expect, it } from 'vitest';
import { deal, planFor } from './deal';
import { deckById, eligible } from './decks';
import { roundFlow } from './machine';
import type { Mechanic } from './types';

const deck = deckById('halloween');
const players = ['p1', 'p2', 'p3', 'p4'];
const base = { deck, heatCap: 2 as const, usedCardIds: [], playerIds: players, playedPlayerIds: [] };

describe('setting up a round', () => {
  it('gives every mechanic that opens on a clock a deadline to open with', () => {
    for (const mechanic of ['solo', 'allplay', 'guesswho', 'duel'] as Mechanic[]) {
      const card = eligible(deck, { heatCap: 2, usedIds: [], mechanic })[0];
      const plan = planFor(card);
      const opensOnAClock = ['submitting', 'performing'].includes(roundFlow(mechanic)[0]);
      expect(Boolean(plan.secs), `${mechanic} starts at ${plan.phase}`).toBe(opensOnAClock);
    }
  });

  it('deals a one-tap card straight into the vote', () => {
    // Nothing to write and nobody to watch, so there is no phase in front of
    // it — the card appears and the room answers.
    const card = eligible(deck, { heatCap: 1, usedIds: [], mechanic: 'split' })[0];
    expect(planFor(card).phase).toBe('voting');
  });
});

describe('dealing into a phase', () => {
  it('deals nothing during an admin phase', () => {
    expect(deal({ ...base, phase: 'intermission' })).toMatchObject({ reason: 'not-a-playing-phase' });
  });

  it('only ever deals tap-only cards in the warm-up', () => {
    for (let i = 0; i < 24; i += 1) {
      const out = deal({ ...base, phase: 'warmup', heatCap: 1 });
      expect(['split', 'poll']).toContain(out.ok && out.plan.mechanic);
    }
  });

  it('never exceeds the courage dial', () => {
    const used: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      const out = deal({ ...base, phase: 'round1', heatCap: 1, usedCardIds: used });
      if (!out.ok) break;
      used.push(out.plan.cardId);
      expect(deck.cards.find((c) => c.id === out.plan.cardId)!.heat).toBeLessThanOrEqual(1);
    }
    expect(used.length).toBeGreaterThan(0);
  });

  it('never deals the same card twice', () => {
    const used: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const out = deal({ ...base, phase: 'round2', heatCap: 2, usedCardIds: used });
      if (!out.ok) {
        expect(out.reason).toBe('deck-exhausted');
        break;
      }
      expect(used).not.toContain(out.plan.cardId);
      used.push(out.plan.cardId);
    }
  });

  it('gives everyone a solo turn before anyone gets a second', () => {
    const played: string[] = [];
    for (let i = 0; i < players.length; i += 1) {
      const out = deal({ ...base, phase: 'round1', heatCap: 1, playedPlayerIds: played }, () => 0);
      if (!out.ok || out.plan.mechanic !== 'solo') continue;
      expect(played).not.toContain(out.plan.turnPlayerId);
      played.push(out.plan.turnPlayerId!);
    }
  });

  it('sets the finale duel between the two people actually leading', () => {
    const standings = [
      { playerId: 'p1', score: 3 },
      { playerId: 'p2', score: 11 },
      { playerId: 'p3', score: 9 },
      { playerId: 'p4', score: 1 },
    ];
    for (let i = 0; i < 20; i += 1) {
      const out = deal({ ...base, phase: 'finale', standings });
      if (!out.ok || out.plan.mechanic !== 'duel') continue;
      expect([out.plan.turnPlayerId, out.plan.opponentId]).toEqual(['p2', 'p3']);
      return;
    }
    throw new Error('the finale never dealt a duel');
  });

  it('will not deal a duel to a room of one', () => {
    for (let i = 0; i < 20; i += 1) {
      const out = deal({ ...base, phase: 'finale', playerIds: ['p1'] });
      if (out.ok) expect(out.plan.mechanic).not.toBe('duel');
    }
  });
});
