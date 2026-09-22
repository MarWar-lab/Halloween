import { describe, expect, it } from 'vitest';
import { allClipUrls, nextClipUrl } from './clipPrefetch';
import { QUESTIONS } from './questions';

describe('allClipUrls', () => {
  it('lists every question that carries a clip, in question order', () => {
    const urls = allClipUrls();
    expect(urls).toEqual(QUESTIONS.filter((q) => q.clip).map((q) => q.clip));
  });

  it('carries no duplicates — nine questions, nine distinct clips', () => {
    expect(new Set(allClipUrls()).size).toBe(allClipUrls().length);
  });
});

describe('nextClipUrl', () => {
  it("names the following question's clip", () => {
    for (let i = 0; i < QUESTIONS.length - 1; i += 1) {
      expect(nextClipUrl(i)).toBe(QUESTIONS[i + 1].clip ?? null);
    }
  });

  it('is null past the last question — there is no next clip to warm', () => {
    expect(nextClipUrl(QUESTIONS.length - 1)).toBeNull();
  });

  it('is null for an index far past the end, rather than throwing', () => {
    expect(nextClipUrl(QUESTIONS.length + 10)).toBeNull();
  });
});
