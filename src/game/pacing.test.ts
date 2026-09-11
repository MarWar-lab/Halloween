import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_PHASE,
  PHASE_MINUTES,
  PLANNED_CARDS,
  TARGET_MINUTES,
  minutesBefore,
  pacingFor,
} from './pacing';
import { GAME_PHASES } from './machine';
import { deckById } from './decks';
import type { Game, GamePhase } from './types';

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g',
  code: 'ABCD',
  hostUserId: 'h',
  deckId: 'halloween',
  themeId: 'halloween',
  phase: 'warmup',
  roundNo: 0,
  heatCap: 1,
  createdAt: '2026-10-31T19:00:00.000Z',
  ...over,
});

const at = (minutes: number) => Date.parse('2026-10-31T19:00:00.000Z') + minutes * 60000;

describe('the evening fits in the time it promises', () => {
  it('budgets exactly the target, not two hours', () => {
    const total = Object.values(PHASE_MINUTES).reduce((a, b) => a + b, 0);
    expect(total).toBe(TARGET_MINUTES);
  });

  it('budgets a chapter for every phase, so none is unplanned', () => {
    for (const phase of GAME_PHASES) {
      expect(PHASE_MINUTES[phase]).toBeGreaterThan(0);
      expect(CARDS_PER_PHASE[phase]).toBeGreaterThanOrEqual(0);
    }
  });

  it('only asks for cards in the chapters that deal them', () => {
    for (const phase of ['lobby', 'briefing', 'intermission', 'awards'] as GamePhase[]) {
      expect(CARDS_PER_PHASE[phase]).toBe(0);
    }
  });

  it('asks for fewer cards than the deck holds, so a game never runs dry', () => {
    expect(PLANNED_CARDS).toBeLessThan(deckById('halloween').cards.length);
  });

  it('leaves enough minutes per card to actually play it', () => {
    // Reading it out, answering, voting and laughing. Under ninety seconds a
    // card is a treadmill.
    const playing = GAME_PHASES.filter((p) => CARDS_PER_PHASE[p] > 0);
    for (const phase of playing) {
      expect(PHASE_MINUTES[phase] / CARDS_PER_PHASE[phase]).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe('knowing whether the night is running late', () => {
  it('counts chapters from one', () => {
    expect(pacingFor(game({ phase: 'lobby' }), []).chapter).toBe(1);
    expect(pacingFor(game({ phase: 'awards' }), []).chapter).toBe(GAME_PHASES.length);
  });

  it('says on-time when the clock matches the plan', () => {
    const expected = minutesBefore('round1') + PHASE_MINUTES.round1;
    expect(pacingFor(game({ phase: 'round1' }), [], at(expected)).state).toBe('on-time');
  });

  it('says behind only once it is properly behind', () => {
    const expected = minutesBefore('round1') + PHASE_MINUTES.round1;
    // A host nagged from the first minute stops reading the indicator.
    expect(pacingFor(game({ phase: 'round1' }), [], at(expected + 3)).state).toBe('on-time');
    expect(pacingFor(game({ phase: 'round1' }), [], at(expected + 20)).state).toBe('behind');
  });

  it('says ahead when a room is flying', () => {
    expect(pacingFor(game({ phase: 'round2' }), [], at(4)).state).toBe('ahead');
  });

  it('survives a game row with an unparseable timestamp', () => {
    expect(pacingFor(game({ createdAt: 'not a date' }), []).minutesElapsed).toBe(0);
  });

  it('never reports a fraction outside the bar', () => {
    for (const phase of GAME_PHASES) {
      const f = pacingFor(game({ phase }), []).fraction;
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});
