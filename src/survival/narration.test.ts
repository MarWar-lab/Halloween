import { expect, it } from 'vitest';
import { narrationLines } from './narration';
import { OPENING, EXTRACTION_BRIEF, FINAL_PLEA, QUESTIONS } from './questions';

it('splits prose into sentence-sized beats', () => {
  const lines = narrationLines('The world ends on a Tuesday. You are at your desk at home.');
  expect(lines).toEqual(['The world ends on a Tuesday.', 'You are at your desk at home.']);
});

it('merges a mid-abbreviation fragment into the sentence after it', () => {
  // "Ask Mr." would otherwise split into its own fragment at the period.
  const lines = narrationLines('Ask Mr. Han for the code. He will not give it up easily.');
  expect(lines).toEqual(['Ask Mr. Han for the code.', 'He will not give it up easily.']);
});

it('keeps a genuinely short real sentence as its own beat', () => {
  // The bug this guards against: an earlier version merged any sentence
  // under ~12 characters into the next one, which swallowed "One." and
  // "Two." into a single beat — exactly the opposite of what narration is
  // for. A short sentence is often the most dramatic one in the room.
  expect(narrationLines('One. Two. Three.')).toEqual(['One.', 'Two.', 'Three.']);
  expect(narrationLines('Bold. There is no wifi at the end of the world.'))
    .toEqual(['Bold.', 'There is no wifi at the end of the world.']);
});

it('never drops a single word of the source text', () => {
  for (const text of [OPENING, EXTRACTION_BRIEF, FINAL_PLEA.setup, ...QUESTIONS.map((q) => q.setup)]) {
    const words = text.split(/\s+/).filter(Boolean);
    const rejoined = narrationLines(text).join(' ').split(/\s+/).filter(Boolean);
    expect(rejoined.length).toBe(words.length);
  }
});

it('falls back to the whole text as one beat when there is no sentence punctuation', () => {
  expect(narrationLines('no punctuation here')).toEqual(['no punctuation here']);
});
