import { describe, expect, it } from 'vitest';
import { halloween } from './halloween';

const TEXT = (c: (typeof halloween.cards)[number]) =>
  [c.title, c.prompt, c.submitHint ?? '', c.wins].join(' ');

/**
 * A number paired with a unit of time. Deliberately not every mention of the
 * word: "the second half" is an ordinal and "a last-minute costume" is an
 * idiom, and banning those would push the rule into nonsense the next person
 * would rightly delete.
 */
const DURATION =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety|\d+)[\s-](?:seconds?|minutes?|hours?)\b/i;

describe('deck invariants', () => {
  /**
   * A card once read "You have twenty minutes and only what is in the room you
   * are sitting in." Its timer was seventy-five seconds. The host reads the
   * card aloud, so the room hears twenty minutes and the clock disagrees — and
   * a night budgeted at forty-five minutes cannot spend twenty on one card.
   *
   * The rule is simple enough to keep: a card never names a duration. The
   * clock on screen is the only duration there is.
   */
  it('never states a duration the clock cannot honour', () => {
    const offenders = halloween.cards
      .filter((c) => DURATION.test(TEXT(c)))
      .map((c) => `${c.id}: ${TEXT(c).match(DURATION)?.[0]}`);
    expect(offenders, 'cards naming their own duration').toEqual([]);
  });

  /** No single card may take longer than five minutes, whatever it asks for. */
  it('gives no card longer than five minutes', () => {
    for (const c of halloween.cards) {
      expect(c.secs, `${c.id}`).toBeLessThanOrEqual(300);
    }
  });

  it('runs on two courage levels, not three', () => {
    const levels = [...new Set(halloween.cards.map((c) => c.heat))].sort();
    expect(levels).toEqual([1, 2]);
  });

  it('keeps enough of both levels to fill a night', () => {
    for (const heat of [1, 2] as const) {
      const n = halloween.cards.filter((c) => c.heat === heat).length;
      expect(n, `heat ${heat}`).toBeGreaterThanOrEqual(13);
    }
  });

  it('gives every card a unique id', () => {
    const ids = halloween.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
