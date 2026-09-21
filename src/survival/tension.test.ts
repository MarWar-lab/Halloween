import { describe, expect, it } from 'vitest';
import { computeTension, type TensionInput } from './tension';

const base: TensionInput = {
  phase: 'running',
  playerCount: 10,
  answeredCount: 10,
  pleadedCount: 0,
  votedCount: 0,
  escapedCount: 0,
  teamAttempts: 0,
  puzzles: [],
};

describe('computeTension', () => {
  it('is zero in the lobby with nobody waiting on anybody', () => {
    expect(computeTension({ ...base, phase: 'lobby', answeredCount: 0 })).toBe(0);
  });

  it('rises while the room is still answering', () => {
    const empty = computeTension({ ...base, answeredCount: 0 });
    const full = computeTension({ ...base, answeredCount: 10 });
    expect(empty).toBeGreaterThan(full);
  });

  it('the tribunal starts tenser than a running round, all else equal', () => {
    const running = computeTension({ ...base, phase: 'running', answeredCount: 0 });
    const tribunal = computeTension({ ...base, phase: 'tribunal', votedCount: 0 });
    expect(tribunal).toBeGreaterThan(running);
  });

  it('a berth with fragments posted but not solved raises tension', () => {
    const quiet = computeTension({ ...base, puzzles: [{ posted: 0, total: 5, asking: 0, solved: false }] });
    const stuck = computeTension({ ...base, puzzles: [{ posted: 2, total: 5, asking: 0, solved: false }] });
    expect(stuck).toBeGreaterThan(quiet);
  });

  it('people actively asking for help raises tension even before anyone has posted', () => {
    const nobodyAsking = computeTension({ ...base, puzzles: [{ posted: 0, total: 5, asking: 0, solved: false }] });
    const askingForHelp = computeTension({ ...base, puzzles: [{ posted: 0, total: 5, asking: 3, solved: false }] });
    expect(askingForHelp).toBeGreaterThan(nobodyAsking);
  });

  it('a solved berth contributes nothing, however many fragments or asks it took', () => {
    const solved = computeTension({ ...base, puzzles: [{ posted: 5, total: 5, asking: 5, solved: true }] });
    expect(solved).toBe(computeTension({ ...base, puzzles: [] }));
  });

  it('repeated wrong keypad guesses raise tension but cap out', () => {
    const few = computeTension({ ...base, teamAttempts: 1 });
    const many = computeTension({ ...base, teamAttempts: 6 });
    const tooMany = computeTension({ ...base, teamAttempts: 60 });
    expect(many).toBeGreaterThan(few);
    expect(tooMany).toBe(many);
  });

  it('escapes bring tension down', () => {
    const none = computeTension({ ...base, escapedCount: 0 });
    const some = computeTension({ ...base, escapedCount: 5 });
    expect(some).toBeLessThan(none);
  });

  it('never leaves [0, 1]', () => {
    for (const phase of ['lobby', 'briefing', 'running', 'plea', 'tribunal', 'result'] as const) {
      for (const teamAttempts of [0, 3, 6, 20]) {
        const t = computeTension({ ...base, phase, teamAttempts });
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });
});
