import { describe, expect, it } from 'vitest';
import {
  applyResults,
  median,
  scoreAllplay,
  scoreDuel,
  scoreGuessWho,
  scoreSolo,
  validVotes,
} from './scoring';
import type { Submission, Vote } from './types';

const vote = (v: Partial<Vote> & { voterId: string }): Vote => ({
  id: crypto.randomUUID(),
  roundId: 'r1',
  submissionId: null,
  targetPlayerId: null,
  score: null,
  guessPlayerId: null,
  ...v,
});

const sub = (playerId: string, text = 'x'): Submission => ({
  id: `s-${playerId}`,
  roundId: 'r1',
  playerId,
  text,
  createdAt: new Date().toISOString(),
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3])).toBe(3);
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is empty-safe', () => {
    expect(median([])).toBe(0);
  });

  it('resists a single troll and a single loyalist', () => {
    // Four honest 4s, one 1 and one 5. The median must not move.
    expect(median([4, 4, 4, 4, 1, 5])).toBe(4);
  });
});

describe('validVotes', () => {
  it('keeps only the first vote per voter', () => {
    const votes = [
      vote({ voterId: 'a', score: 5 }),
      vote({ voterId: 'a', score: 1 }),
      vote({ voterId: 'b', score: 3 }),
    ];
    expect(validVotes(votes)).toHaveLength(2);
  });

  it('drops the performer voting on their own turn', () => {
    const votes = [vote({ voterId: 'p', score: 5 }), vote({ voterId: 'b', score: 2 })];
    expect(validVotes(votes, 'p').map((v) => v.voterId)).toEqual(['b']);
  });
});

describe('scoreSolo', () => {
  it('awards the median of peer scores', () => {
    const votes = [
      vote({ voterId: 'a', score: 4 }),
      vote({ voterId: 'b', score: 5 }),
      vote({ voterId: 'c', score: 4 }),
    ];
    expect(scoreSolo('p', votes).points.p).toBe(4);
  });

  it('gives zero — not a default — when nobody voted', () => {
    const r = scoreSolo('p', []);
    expect(r.points.p).toBe(0);
    expect(r.notes?.p).toMatch(/no votes/);
  });
});

describe('scoreAllplay', () => {
  it('gives a point for submitting and two per vote received', () => {
    const subs = [sub('a'), sub('b'), sub('c')];
    const votes = [
      vote({ voterId: 'a', targetPlayerId: 'b' }),
      vote({ voterId: 'b', targetPlayerId: 'c' }),
      vote({ voterId: 'c', targetPlayerId: 'b' }),
    ];
    const r = scoreAllplay(subs, votes);
    expect(r.points.b).toBe(1 + 4);
    expect(r.points.c).toBe(1 + 2);
    // Submitted, received nothing, still on the board.
    expect(r.points.a).toBe(1);
  });

  it('discards self-votes', () => {
    const r = scoreAllplay([sub('a'), sub('b')], [vote({ voterId: 'a', targetPlayerId: 'a' })]);
    expect(r.points.a).toBe(1);
  });

  it('reveals authorship only in the results', () => {
    const r = scoreAllplay([sub('a')], []);
    expect(r.authors).toEqual({ 's-a': 'a' });
  });
});

describe('scoreGuessWho', () => {
  it('rewards correct guesses and fooling people', () => {
    // Two voters guess at a submission authored by 'a'.
    const votes = [
      vote({ voterId: 'b', targetPlayerId: 'a', guessPlayerId: 'a' }), // correct
      vote({ voterId: 'c', targetPlayerId: 'a', guessPlayerId: 'b' }), // fooled
    ];
    const r = scoreGuessWho([sub('a')], votes);
    expect(r.points.b).toBe(2);
    expect(r.points.a).toBe(1);
    expect(r.notes?.a).toBe('fooled 1');
  });
});

describe('scoreDuel', () => {
  it('gives three to the winner and one for turning up', () => {
    const votes = [
      vote({ voterId: 'x', targetPlayerId: 'a' }),
      vote({ voterId: 'y', targetPlayerId: 'a' }),
      vote({ voterId: 'z', targetPlayerId: 'b' }),
    ];
    const r = scoreDuel('a', 'b', votes);
    expect(r.points.a).toBe(4);
    expect(r.points.b).toBe(1);
  });

  it('splits a draw rather than going to sudden death', () => {
    const votes = [
      vote({ voterId: 'x', targetPlayerId: 'a' }),
      vote({ voterId: 'y', targetPlayerId: 'b' }),
    ];
    const r = scoreDuel('a', 'b', votes);
    expect(r.points.a).toBe(2);
    expect(r.points.b).toBe(2);
  });
});

describe('applyResults', () => {
  it('accumulates without mutating the input', () => {
    const totals = { a: 3 };
    const next = applyResults(totals, { points: { a: 2, b: 1 } });
    expect(next).toEqual({ a: 5, b: 1 });
    expect(totals).toEqual({ a: 3 });
  });
});
