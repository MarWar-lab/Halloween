import { expect, it } from 'vitest';
import { buildDebrief } from './debrief';
import { QUESTIONS } from './questions';
import type { Answer } from './types';

const ans = (playerId: string, questionIdx: number, optionIndex: number, autoAssigned = false): Answer => ({
  playerId, questionIdx, optionIndex, autoAssigned,
});

it('has nothing to say about an empty or a one-player night', () => {
  expect(buildDebrief([])).toEqual([]);
  expect(buildDebrief([ans('a', 0, 1)])).toEqual([]);
});

it('names the round the room split hardest, and the one it agreed on', () => {
  const answers: Answer[] = [
    // Question 0: three-way split, nobody agrees.
    ans('a', 0, 0), ans('b', 0, 1), ans('c', 0, 2),
    // Question 1: everybody picks the same thing.
    ans('a', 1, 3), ans('b', 1, 3), ans('c', 1, 3),
  ];
  const prompts = buildDebrief(answers);
  const titles = prompts.map((p) => p.title);
  expect(titles.some((t) => t.includes(QUESTIONS[0].title) && t.startsWith('Where you split'))).toBe(true);
  expect(titles.some((t) => t.includes(QUESTIONS[1].title) && t.startsWith('Where you all agreed'))).toBe(true);
});

it('never counts an auto-assigned answer as a real choice', () => {
  // Both of these are the same single "real" answer, plus a silent
  // auto-assigned one for each round — with only one real answer left, there
  // is nothing to call split or unanimous.
  const answers: Answer[] = [
    ans('a', 0, 1),
    ans('b', 0, 2, true),
  ];
  expect(buildDebrief(answers)).toEqual([]);
});

it('calls out the round with the most real uptake on its ruthless option', () => {
  // Question 3's dark option is index 0 (see DARK_CHOICES in questions.ts).
  const answers: Answer[] = [
    ans('a', 3, 0), ans('b', 3, 0), ans('c', 3, 1),
    // A silent auto-assign onto the same dark option must not inflate the count.
    ans('d', 3, 0, true),
  ];
  const prompts = buildDebrief(answers);
  const hardest = prompts.find((p) => p.title.startsWith('The hardest call'));
  expect(hardest?.title).toContain(QUESTIONS[3].title);
  expect(hardest?.body).toContain('2 of 3');
});

it('returns at most three prompts', () => {
  const answers: Answer[] = QUESTIONS.flatMap((_, q) => [
    ans('a', q, q % 2),
    ans('b', q, (q + 1) % 2),
  ]);
  expect(buildDebrief(answers).length).toBeLessThanOrEqual(3);
});
