import { describe, expect, it } from 'vitest';
import {
  applyResults,
  median,
  scoreAllplay,
  scoreDuel,
  scoreGuessWho,
  scoreSolo,
  scoreSplit,
  validVotes,
} from './scoring';
import type { Submission, Vote } from './types';

const vote = (v: Partial<Vote> & { voterId: string }): Vote => ({
  id: crypto.randomUUID(),
  roundId: 'r1',
  submissionId: null,
  targetPlayerId: null,
  score: null,
  optionIndex: null,
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

describe('scoreSplit explains itself', () => {
  const vote = (voterId: string, optionIndex: 0 | 1) =>
    ({ id: `v-${voterId}`, roundId: 'r', voterId, optionIndex }) as never;

  it('pays the minority two extra and says so', () => {
    const out = scoreSplit([vote('a', 0), vote('b', 1), vote('c', 1)]);
    expect(out.points).toEqual({ a: 3, b: 1, c: 1 });
    expect(out.notes!.a).toBe('with the few');
    expect(out.notes!.b).toBe('with the many');
  });

  /**
   * A 6-0 split used to pay a flat 1 with no note at all, which on screen was
   * indistinguishable from losing — while a 3-3 split on the same card pays
   * everyone 3. The points are deliberately unchanged; the reason is not.
   */
  it('tells a unanimous room that it was unanimous', () => {
    const out = scoreSplit([vote('a', 1), vote('b', 1), vote('c', 1)]);
    expect(out.points).toEqual({ a: 1, b: 1, c: 1 });
    expect(out.notes!.a).toBe('the whole room agreed');
  });

  it('pays everyone on a dead heat', () => {
    const out = scoreSplit([vote('a', 0), vote('b', 1)]);
    expect(out.points).toEqual({ a: 3, b: 3 });
    expect(out.notes!.a).toBe('split down the middle');
  });

  it('leaves nobody unexplained', () => {
    for (const votes of [
      [vote('a', 0), vote('b', 1), vote('c', 1)],
      [vote('a', 1), vote('b', 1)],
      [vote('a', 0), vote('b', 1)],
    ]) {
      const out = scoreSplit(votes);
      for (const v of votes) expect(out.notes![(v as { voterId: string }).voterId]).toBeTruthy();
    }
  });
});
