import { describe, expect, it } from 'vitest';
import {
  PHASES,
  PHASE_MINUTES,
  minutesBefore,
  minutesIntoRunning,
  pacingFor,
  QUESTION_MINUTES,
  WARMUP_MINUTES,
} from './pacing';
import { INTRO_QUESTIONS, QUESTIONS } from './questions';
import type { Phase } from './types';

const gameAt = (phase: Phase, questionIdx: number, minutesAgo: number) => ({
  phase,
  questionIdx,
  createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
});

describe('the budget', () => {
  it('spends its running block on the questions and nothing else', () => {
    // If these drift apart the indicator lies in the middle of the night,
    // which is exactly when a host is relying on it.
    const fromQuestions =
      INTRO_QUESTIONS.length * WARMUP_MINUTES + QUESTIONS.length * QUESTION_MINUTES;
    expect(fromQuestions).toBe(PHASE_MINUTES.running);
  });

  it('covers every phase the machine can be in', () => {
    for (const phase of PHASES) expect(PHASE_MINUTES[phase]).toBeGreaterThan(0);
  });

  it('counts nothing before the lobby and everything before the result', () => {
    expect(minutesBefore('lobby')).toBe(0);
    expect(minutesBefore('result')).toBe(
      PHASE_MINUTES.lobby +
        PHASE_MINUTES.briefing +
        PHASE_MINUTES.running +
        PHASE_MINUTES.plea +
        PHASE_MINUTES.tribunal,
    );
  });
});

describe('minutesIntoRunning', () => {
  it('charges a warm-up less than a real question', () => {
    expect(minutesIntoRunning(-2)).toBe(0);
    expect(minutesIntoRunning(-1)).toBe(WARMUP_MINUTES);
    expect(minutesIntoRunning(0)).toBe(INTRO_QUESTIONS.length * WARMUP_MINUTES);
  });

  it('climbs by one question at a time once the stakes start', () => {
    expect(minutesIntoRunning(1) - minutesIntoRunning(0)).toBe(QUESTION_MINUTES);
    expect(minutesIntoRunning(8) - minutesIntoRunning(7)).toBe(QUESTION_MINUTES);
  });

  it('never goes backwards across the whole arc', () => {
    let last = -1;
    for (let q = -INTRO_QUESTIONS.length; q < QUESTIONS.length; q += 1) {
      const now = minutesIntoRunning(q);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe('pacingFor', () => {
  it('reads on-time for a room that is where the plan puts it', () => {
    // Question one of nine, in an eight-person room: lobby, briefing and the
    // two warm-ups are behind them.
    const expected = minutesBefore('running') + minutesIntoRunning(0) + QUESTION_MINUTES;
    expect(pacingFor(gameAt('running', 0, expected), 8).state).toBe('on-time');
  });

  it('calls a room behind only once it is properly late', () => {
    const at = (minutesAgo: number) => pacingFor(gameAt('running', 0, minutesAgo), 8).state;
    const expected = pacingFor(gameAt('running', 0, 0), 8).minutesExpected;
    // A host nagged from minute one stops reading the indicator at all.
    expect(at(expected + 4)).toBe('on-time');
    expect(at(expected + 20)).toBe('behind');
  });

  it('calls a room ahead when it is racing', () => {
    expect(pacingFor(gameAt('tribunal', 8, 1), 8).state).toBe('ahead');
  });

  it('gives a bigger room longer before it is late', () => {
    // The same beat at the same wall-clock time must not read "behind" for
    // twenty people and "on-time" for eight — discussion is what scales.
    const small = pacingFor(gameAt('running', 4, 30), 8);
    const large = pacingFor(gameAt('running', 4, 30), 20);
    expect(large.minutesExpected).toBeGreaterThan(small.minutesExpected);
    expect(large.minutesTarget).toBeGreaterThan(small.minutesTarget);
  });

  it('never expects more than it promised', () => {
    for (const players of [5, 8, 12, 20, 40]) {
      const end = pacingFor(gameAt('result', 8, 0), players);
      expect(end.minutesExpected).toBeLessThanOrEqual(end.minutesTarget);
    }
  });
});

describe('the beat counter', () => {
  it('counts every question rather than saying "phase 3 of 6" all night', () => {
    const total = 2 + INTRO_QUESTIONS.length + QUESTIONS.length + 3;
    expect(pacingFor(gameAt('lobby', -2, 0), 8).beatCount).toBe(total);
  });

  it('runs from the first beat to the last without repeating or skipping', () => {
    const seen: number[] = [];
    seen.push(pacingFor(gameAt('lobby', -2, 0), 8).beat);
    seen.push(pacingFor(gameAt('briefing', -2, 0), 8).beat);
    for (let q = -INTRO_QUESTIONS.length; q < QUESTIONS.length; q += 1) {
      seen.push(pacingFor(gameAt('running', q, 0), 8).beat);
    }
    for (const phase of ['plea', 'tribunal', 'result'] as Phase[]) {
      seen.push(pacingFor(gameAt(phase, 8, 0), 8).beat);
    }
    expect(seen).toEqual(seen.map((_, i) => i + 1));
  });

  it('fills the bar exactly once, at the end', () => {
    expect(pacingFor(gameAt('lobby', -2, 0), 8).fraction).toBe(0);
    expect(pacingFor(gameAt('result', 8, 0), 8).fraction).toBe(1);
  });
});
