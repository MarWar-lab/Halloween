import { describe, expect, it } from 'vitest';
import { choicesFor, eligibleVoters, myBallot, orderedSubmissions, votableChoices } from './ballot';
import type { Round, Submission, Vote } from './types';

const sub = (id: string, playerId: string | null, createdAt: string, text = id): Submission => ({
  id,
  roundId: 'r',
  playerId,
  text,
  createdAt,
});

// Deliberately out of order, and two sharing a timestamp.
const answers = [
  sub('s3', 'cleo', '2026-10-31T20:00:02Z'),
  sub('s1', 'ana', '2026-10-31T20:00:00Z'),
  sub('s4', 'dev', '2026-10-31T20:00:02Z'),
  sub('s2', 'ben', '2026-10-31T20:00:01Z'),
];

describe('numbering the answers', () => {
  it('gives the same order however the rows arrive', () => {
    const a = orderedSubmissions(answers).map((s) => s.id);
    const b = orderedSubmissions([...answers].reverse()).map((s) => s.id);
    expect(a).toEqual(b);
  });

  it('breaks a tied timestamp deterministically rather than by luck', () => {
    // s3 and s4 share a millisecond. Without a tiebreak two clients can
    // disagree, and then "number three" means different things in the room.
    const order = orderedSubmissions(answers).map((s) => s.id);
    expect(order).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('numbers identically for the shared screen and for every player', () => {
    // The bug this file exists for: the Stage numbered from every answer and
    // each phone from a list with its own author removed.
    const stage = choicesFor(answers, null);
    for (const who of ['ana', 'ben', 'cleo', 'dev']) {
      const phone = choicesFor(answers, who);
      expect(phone.map((c) => [c.number, c.submission.id])).toEqual(
        stage.map((c) => [c.number, c.submission.id]),
      );
    }
  });

  it('keeps your own answer in the list, numbered, but not votable', () => {
    const ben = choicesFor(answers, 'ben');
    const mine = ben.find((c) => c.mine)!;
    expect(mine.submission.id).toBe('s2');
    expect(mine.number).toBe(2);
    expect(votableChoices(ben).map((c) => c.number)).toEqual([1, 3, 4]);
  });

  it('treats an anonymous list as nobody’s, so a spectator can vote on none of it', () => {
    // Authors are masked until scoring, so most viewers see playerId null.
    const masked = answers.map((s) => ({ ...s, playerId: null }));
    expect(choicesFor(masked, 'ana').some((c) => c.mine)).toBe(false);
  });
});

describe('reading back one voter’s ballot', () => {
  const vote = (over: Partial<Vote>): Vote => ({
    id: Math.random().toString(36),
    roundId: 'r',
    voterId: 'ben',
    submissionId: null,
    targetPlayerId: null,
    score: null,
    guessPlayerId: null,
    ...over,
  });

  it('collects every guess, not just the first', () => {
    const b = myBallot(
      [
        vote({ submissionId: 's1', guessPlayerId: 'ana' }),
        vote({ submissionId: 's3', guessPlayerId: 'cleo' }),
        vote({ voterId: 'other', submissionId: 's1', guessPlayerId: 'dev' }),
      ],
      'ben',
    );
    expect(b.guesses).toEqual({ s1: 'ana', s3: 'cleo' });
  });

  it('reads a single-vote mechanic back', () => {
    expect(myBallot([vote({ score: 4 })], 'ben').score).toBe(4);
    expect(myBallot([vote({ submissionId: 's1' })], 'ben').submissionId).toBe('s1');
  });

  it('is empty for someone who has not voted', () => {
    expect(myBallot([vote({ voterId: 'ana', score: 5 })], 'ben')).toEqual({
      score: null,
      targetPlayerId: null,
      submissionId: null,
      guesses: {},
    });
  });
});

describe('who is actually expected to vote', () => {
  const players = [{ id: 'ana' }, { id: 'ben' }, { id: 'cleo' }];
  const round = (over: Partial<Round>): Round => ({
    id: 'r',
    gameId: 'g',
    idx: 1,
    cardId: 'c',
    mechanic: 'solo',
    turnPlayerId: null,
    opponentId: null,
    phase: 'voting',
    deadlineAt: null,
    results: null,
    ...over,
  });

  it('excuses the performer from scoring their own turn', () => {
    expect(eligibleVoters(round({ turnPlayerId: 'ana' }), players).map((p) => p.id)).toEqual([
      'ben',
      'cleo',
    ]);
  });

  it('excuses both duellists', () => {
    const duel = round({ mechanic: 'duel', turnPlayerId: 'ana', opponentId: 'ben' });
    expect(eligibleVoters(duel, players).map((p) => p.id)).toEqual(['cleo']);
  });

  it('expects everyone when nobody is up', () => {
    expect(eligibleVoters(round({ mechanic: 'allplay' }), players)).toHaveLength(3);
  });
});
