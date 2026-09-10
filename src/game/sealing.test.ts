import { describe, expect, it } from 'vitest';
import { visibleSubmissions, visibleVotes } from './sealing';
import { roundFlow } from './machine';
import type { RoundPhase, Submission, Vote } from './types';

const subs: Submission[] = [
  { id: 's1', roundId: 'r', playerId: 'me', text: 'mine', createdAt: '' },
  { id: 's2', roundId: 'r', playerId: 'other', text: 'theirs', createdAt: '' },
];

const votes: Vote[] = [
  { id: 'v1', roundId: 'r', voterId: 'me', targetPlayerId: 'other', score: null, guessPlayerId: null },
  { id: 'v2', roundId: 'r', voterId: 'other', targetPlayerId: 'me', score: null, guessPlayerId: null },
];

describe('submission sealing', () => {
  it('hides other people while answers are still being written', () => {
    const seen = visibleSubmissions(subs, 'submitting', 'me');
    expect(seen.map((s) => s.id)).toEqual(['s1']);
  });

  it('always shows you your own answer', () => {
    for (const phase of ['submitting', 'revealing', 'voting', 'scored'] as RoundPhase[]) {
      expect(visibleSubmissions(subs, phase, 'me').some((s) => s.id === 's1')).toBe(true);
    }
  });

  it('opens everything at the reveal', () => {
    expect(visibleSubmissions(subs, 'revealing', 'me')).toHaveLength(2);
  });

  it('keeps answers readable while voting — you cannot vote on what you cannot read', () => {
    // This is a regression test: the first implementation sealed answers again
    // during `voting`, which left the vote buttons with nothing to point at.
    expect(visibleSubmissions(subs, 'voting', 'me')).toHaveLength(2);
  });

  it('shows a spectator with no seat nothing until the reveal', () => {
    expect(visibleSubmissions(subs, 'submitting', null)).toHaveLength(0);
    expect(visibleSubmissions(subs, 'revealing', null)).toHaveLength(2);
  });
});

describe('vote sealing', () => {
  it('hides other people’s votes until scoring, so nobody piles on', () => {
    for (const phase of ['submitting', 'revealing', 'voting'] as RoundPhase[]) {
      expect(visibleVotes(votes, phase, 'me').map((v) => v.id)).toEqual(['v1']);
    }
    expect(visibleVotes(votes, 'scored', 'me')).toHaveLength(2);
  });
});

describe('sealing lines up with the round flow', () => {
  it('every mechanic seals answers during its writing phase and opens them before voting', () => {
    for (const mechanic of ['allplay', 'guesswho'] as const) {
      const flow = roundFlow(mechanic);
      const writing = flow.indexOf('submitting');
      const voting = flow.indexOf('voting');

      expect(visibleSubmissions(subs, flow[writing], 'me')).toHaveLength(1);
      expect(visibleSubmissions(subs, flow[voting], 'me')).toHaveLength(2);
    }
  });
});
