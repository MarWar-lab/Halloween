import { describe, expect, it } from 'vitest';
import { visibleSubmissions, visibleVotes } from './sealing';
import { roundFlow } from './machine';
import type { RoundPhase, Submission, Vote } from './types';

const subs: Submission[] = [
  { id: 's1', roundId: 'r', playerId: 'me', text: 'mine', createdAt: '' },
  { id: 's2', roundId: 'r', playerId: 'other', text: 'theirs', createdAt: '' },
];

const votes: Vote[] = [
  { id: 'v1', roundId: 'r', voterId: 'me', submissionId: 's2', targetPlayerId: 'other', score: null, optionIndex: null, guessPlayerId: null },
  { id: 'v2', roundId: 'r', voterId: 'other', submissionId: 's1', targetPlayerId: 'me', score: null, optionIndex: null, guessPlayerId: null },
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

  it('hands out the answers without the names attached', () => {
    // Voting for the funniest answer only means anything while nobody can see
    // whose it is. An author id in the payload defeats the mechanic even if no
    // component ever renders it.
    const seen = visibleSubmissions(subs, 'voting', 'me');
    expect(seen.find((s) => s.id === 's2')!.playerId).toBeNull();
    // Your own answer stays identifiable, so the UI can stop you voting for it.
    expect(seen.find((s) => s.id === 's1')!.playerId).toBe('me');
  });

  it('names the authors once the round is scored', () => {
    const seen = visibleSubmissions(subs, 'scored', 'me');
    expect(seen.find((s) => s.id === 's2')!.playerId).toBe('other');
  });

  it('never names an author to the shared screen mid-round', () => {
    // The Stage has no seat, so *every* answer is somebody else's.
    for (const phase of ['revealing', 'voting'] as RoundPhase[]) {
      expect(visibleSubmissions(subs, phase, null).map((s) => s.playerId)).toEqual([null, null]);
    }
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
