import { describe, expect, it } from 'vitest';
import {
  GAME_PHASES,
  duelPairing,
  heatCapFor,
  mechanicsFor,
  nextGamePhase,
  nextRoundPhase,
  nextTurnPlayer,
  isPlayingPhase,
  roundFlow,
} from './machine';
import { deckById, deviceFreeCountByHeat, draw, eligible } from './decks';
import type { GamePhase } from './types';
import type { Heat } from './types';

describe('game phases', () => {
  it('advances in order and terminates at awards', () => {
    let phase = GAME_PHASES[0];
    const seen = [phase];
    for (let i = 0; i < 20; i += 1) {
      phase = nextGamePhase(phase);
      seen.push(phase);
      if (phase === 'awards') break;
    }
    expect(seen).toEqual(GAME_PHASES);
    expect(nextGamePhase('awards')).toBe('awards');
  });

  it('never lets heat go backwards', () => {
    // The whole design rests on this: courage climbs, it never retreats.
    let previous = 0;
    for (const phase of GAME_PHASES) {
      const heat = heatCapFor(phase);
      expect(heat).toBeGreaterThanOrEqual(previous);
      previous = heat;
    }
  });

  it('opens with the one-tap card, so the first thing asked of anyone is a tap', () => {
    // Stronger than the all-play this replaced: an all-play still asks a
    // nervous person to compose a sentence in front of strangers.
    expect(mechanicsFor('warmup')).toEqual(['split']);
  });

  it('ends on duels', () => {
    expect(mechanicsFor('finale')).toContain('duel');
  });
});

describe('round flow', () => {
  it('seals before it opens the vote', () => {
    const flow = roundFlow('allplay');
    expect(flow.indexOf('submitting')).toBeLessThan(flow.indexOf('voting'));
  });

  it('costs the host as few clicks as the mechanic allows', () => {
    // Every phase is a click the host has to make while the room waits. A
    // `choosing` phase with no interface, and a `revealing` phase that showed
    // exactly what `voting` shows, were two of those clicks per card.
    expect(roundFlow('split')).toEqual(['voting', 'scored']);
    expect(roundFlow('allplay')).toEqual(['submitting', 'voting', 'scored']);
    expect(roundFlow('solo')[0]).toBe('performing');
    for (const m of ['solo', 'allplay', 'guesswho', 'duel', 'split'] as const) {
      expect(roundFlow(m).length).toBeLessThanOrEqual(3);
    }
  });

  it('always terminates at scored', () => {
    for (const m of ['solo', 'allplay', 'guesswho', 'duel', 'split'] as const) {
      let phase = roundFlow(m)[0];
      for (let i = 0; i < 10; i += 1) phase = nextRoundPhase(m, phase);
      expect(phase).toBe('scored');
    }
  });
});

describe('turn order', () => {
  it('gives everyone a turn before anyone repeats', () => {
    const players = ['a', 'b', 'c', 'd'];
    const played: string[] = [];
    for (let i = 0; i < players.length; i += 1) {
      const next = nextTurnPlayer(players, played);
      expect(next).not.toBeNull();
      expect(played).not.toContain(next);
      played.push(next as string);
    }
    expect(new Set(played).size).toBe(players.length);
  });

  it('reverses the order on the second cycle', () => {
    const players = ['a', 'b', 'c'];
    expect(nextTurnPlayer(players, [], 0)).toBe('a');
    expect(nextTurnPlayer(players, [], 1)).toBe('c');
  });

  it('is empty-safe', () => {
    expect(nextTurnPlayer([], [])).toBeNull();
  });
});

describe('duel pairing', () => {
  it('pairs the top two', () => {
    expect(
      duelPairing([
        { playerId: 'a', score: 2 },
        { playerId: 'b', score: 9 },
        { playerId: 'c', score: 5 },
      ]),
    ).toEqual(['b', 'c']);
  });

  it('needs two players', () => {
    expect(duelPairing([{ playerId: 'a', score: 1 }])).toBeNull();
  });
});

describe('deck integrity', () => {
  const deck = deckById('halloween');

  it('has unique card ids', () => {
    const ids = deck.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('can run an entire game with no player devices at every heat', () => {
    // The multiplayer half must always be an enhancement, never a requirement.
    const counts = deviceFreeCountByHeat(deck);
    for (const heat of [1, 2, 3] as Heat[]) {
      expect(counts[heat]).toBeGreaterThanOrEqual(4);
    }
  });

  it('does not single one person out more often than it invites everyone in', () => {
    // The deck drifted to 19 solo cards out of 37 — more than half the night
    // spent putting one person on the spot, in a game whose whole premise is
    // that the quiet third of the team can take part. Everyone-at-once
    // mechanics must outnumber solo turns.
    const solo = deck.cards.filter((c) => c.mechanic === 'solo').length;
    const together = deck.cards.filter(
      (c) => c.mechanic === 'allplay' || c.mechanic === 'guesswho',
    ).length;
    expect(together).toBeGreaterThan(solo);
    expect(solo / deck.cards.length).toBeLessThan(0.34);
  });

  it('opens gently: the easiest heat is the biggest part of the deck', () => {
    const byHeat = (h: number) => deck.cards.filter((c) => c.heat === h).length;
    expect(byHeat(1)).toBeGreaterThan(byHeat(2));
    expect(byHeat(2)).toBeGreaterThan(byHeat(3));
  });

  it('offers both lanes at heat 1 so the opening choice is real', () => {
    const heat1 = deck.cards.filter((c) => c.heat === 1 && c.mechanic === 'solo');
    expect(heat1.some((c) => c.lane === 'say')).toBe(true);
    expect(heat1.some((c) => c.lane === 'do')).toBe(true);
  });

  it('never draws a card above the heat cap', () => {
    for (let i = 0; i < 200; i += 1) {
      const card = draw(deck, { heatCap: 1, usedIds: [] });
      expect(card?.heat).toBe(1);
    }
  });

  it('never repeats a used card, and reports exhaustion instead of recycling', () => {
    const used: string[] = [];
    let card = draw(deck, { heatCap: 3, usedIds: used });
    while (card) {
      expect(used).not.toContain(card.id);
      used.push(card.id);
      card = draw(deck, { heatCap: 3, usedIds: used });
    }
    expect(used.length).toBe(deck.cards.length);
    expect(draw(deck, { heatCap: 3, usedIds: used })).toBeNull();
  });

  it('filters by mechanic', () => {
    const only = eligible(deck, { heatCap: 3, usedIds: [], mechanic: 'duel' });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((c) => c.mechanic === 'duel')).toBe(true);
  });
});

describe('the end of the evening', () => {
  it('has nowhere to go after the awards', () => {
    // The console used to offer "next chapter" here, and tell a stuck host to
    // "move to the next chapter first" when there was none. Both are dead ends
    // at the exact moment the evening is meant to land well.
    expect(nextGamePhase('awards')).toBe('awards');
    expect(isPlayingPhase('awards')).toBe(false);
  });

  it('deals no cards in the chapters that are not for playing', () => {
    for (const phase of ['lobby', 'briefing', 'intermission', 'awards'] as GamePhase[]) {
      expect(isPlayingPhase(phase)).toBe(false);
    }
    for (const phase of ['warmup', 'round1', 'round2', 'finale'] as GamePhase[]) {
      expect(isPlayingPhase(phase)).toBe(true);
    }
  });
})
