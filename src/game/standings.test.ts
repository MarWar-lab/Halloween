import { describe, expect, it } from 'vitest';
import { ranked, rankOf } from './standings';

const p = (id: string, name: string, score: number) => ({ id, name, score });

describe('standings', () => {
  it('orders by score, highest first', () => {
    const out = ranked([p('a', 'Amara', 3), p('b', 'Bruno', 9), p('c', 'Chiara', 5)]);
    expect(out.map((x) => x.name)).toEqual(['Bruno', 'Chiara', 'Amara']);
  });

  /**
   * The bug this file exists for: the header pill sorted by score alone and the
   * standings list sorted by score then name, so on a tie one screen said 3rd
   * and the other said 2nd.
   */
  it('breaks ties the same way every time, whatever order it is given', () => {
    const players = [p('d', 'Dmitri', 4), p('a', 'Amara', 4), p('e', 'Elif', 9)];
    const forwards = ranked(players).map((x) => x.name);
    const backwards = ranked([...players].reverse()).map((x) => x.name);
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual(['Elif', 'Amara', 'Dmitri']);
  });

  it('gives a tied player one rank, not two', () => {
    const players = [p('d', 'Dmitri', 4), p('a', 'Amara', 4), p('e', 'Elif', 9)];
    expect(rankOf(players, 'a')).toBe(2);
    expect(rankOf(players, 'd')).toBe(3);
    expect(rankOf([...players].reverse(), 'a')).toBe(2);
    expect(rankOf([...players].reverse(), 'd')).toBe(3);
  });

  it('is total even when two players share a name and a score', () => {
    const players = [p('z', 'Sam', 2), p('a', 'Sam', 2)];
    expect(ranked(players).map((x) => x.id)).toEqual(['a', 'z']);
    expect(ranked([...players].reverse()).map((x) => x.id)).toEqual(['a', 'z']);
  });

  it('returns null for nobody', () => {
    expect(rankOf([p('a', 'Amara', 1)], null)).toBeNull();
    expect(rankOf([p('a', 'Amara', 1)], 'ghost')).toBeNull();
  });

  it('does not mutate its input', () => {
    const players = [p('a', 'Amara', 1), p('b', 'Bruno', 9)];
    ranked(players);
    expect(players.map((x) => x.name)).toEqual(['Amara', 'Bruno']);
  });
});
