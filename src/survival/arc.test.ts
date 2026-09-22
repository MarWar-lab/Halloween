import { expect, it } from 'vitest';
import { actFor } from './arc';
import { QUESTIONS } from './questions';

it('is act 1 for the lobby and the briefing, regardless of questionIdx', () => {
  expect(actFor('lobby', 0)).toBe(1);
  expect(actFor('briefing', -2)).toBe(1);
});

it('is act 1 through both warm-ups', () => {
  expect(actFor('running', -2)).toBe(1);
  expect(actFor('running', -1)).toBe(1);
});

it('climbs from 1 to 3 across the nine questions, never skipping or reversing', () => {
  const acts = QUESTIONS.map((_, i) => actFor('running', i));
  expect(acts[0]).toBe(1);
  expect(acts[acts.length - 1]).toBe(3);
  for (let i = 1; i < acts.length; i += 1) {
    expect(acts[i]).toBeGreaterThanOrEqual(acts[i - 1]);
    expect(acts[i] - acts[i - 1]).toBeLessThanOrEqual(1);
  }
});

it('is act 3 for the plea, the tribunal and the result — the close, not the open', () => {
  expect(actFor('plea', 8)).toBe(3);
  expect(actFor('tribunal', 8)).toBe(3);
  expect(actFor('result', 8)).toBe(3);
});
