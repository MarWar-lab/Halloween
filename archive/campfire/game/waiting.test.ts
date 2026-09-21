import { describe, expect, it } from 'vitest';
import { roomProgress } from './waiting';
import type { Round } from './types';

const players = [
  { id: 'a', name: 'Amara' },
  { id: 'b', name: 'Bruno' },
  { id: 'c', name: 'Chiara' },
];

const round = (over: Partial<Round>): Round =>
  ({
    id: 'r1', gameId: 'g1', cardId: 'c1', mechanic: 'allplay', phase: 'submitting',
    turnPlayerId: null, opponentId: null, deadlineAt: null, results: null,
    ...over,
  }) as Round;

describe('roomProgress', () => {
  it('counts answers while the room is writing', () => {
    const p = roomProgress(players, ['a'], [], round({ phase: 'submitting' }))!;
    expect(p.count).toBe('1 of 3 answered');
    expect(p.who).toEqual(['Bruno', 'Chiara']);
  });

  it('counts votes while the room is voting', () => {
    const p = roomProgress(players, [], ['a', 'b'], round({ phase: 'voting' }))!;
    expect(p.count).toBe('2 of 3 voted');
    expect(p.who).toEqual(['Chiara']);
  });

  /**
   * The performer is being scored, so they have no vote to cast. Counting them
   * leaves the room waiting forever on someone with nothing to do.
   */
  it('excuses whoever is being scored from the vote count', () => {
    const p = roomProgress(players, [], ['b'], round({ phase: 'voting', mechanic: 'solo', turnPlayerId: 'a' }))!;
    expect(p.count).toBe('1 of 2 voted');
    expect(p.who).toEqual(['Chiara']);
  });

  it('excuses both duellists', () => {
    const p = roomProgress(players, [], [], round({ phase: 'voting', mechanic: 'duel', turnPlayerId: 'a', opponentId: 'b' }))!;
    expect(p.count).toBe('0 of 1 voted');
    expect(p.who).toEqual(['Chiara']);
  });

  it('says nothing when the room is not waiting on anyone', () => {
    expect(roomProgress(players, [], [], null)).toBeNull();
    expect(roomProgress(players, [], [], round({ phase: 'scored' }))).toBeNull();
    expect(roomProgress(players, [], [], round({ phase: 'revealing' }))).toBeNull();
  });

  it('reports an empty waiting list once everyone has acted', () => {
    const p = roomProgress(players, ['a', 'b', 'c'], [], round({ phase: 'submitting' }))!;
    expect(p.count).toBe('3 of 3 answered');
    expect(p.who).toEqual([]);
    expect(p.done).toBe(p.total);
  });
});
