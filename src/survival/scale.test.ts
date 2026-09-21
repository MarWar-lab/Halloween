import { describe, expect, it } from 'vitest';
import { partitionInto, seatsFor, targetMinutesFor, teamSizes, teamsFor } from './scale';

describe('seatsFor', () => {
  // The table is the specification. If one of these changes, it should change
  // here first and deliberately, because every one of them is a different
  // shape of evening.
  it.each([
    [5, 3],
    [6, 3],
    [8, 3],
    [12, 3],
    [16, 4],
    [20, 5],
    [24, 6],
  ])('gives %i players %i seats', (players, seats) => {
    expect(seatsFor(players)).toBe(seats);
  });

  it('always leaves at least two people behind', () => {
    // Without this the ending is a formality: a room where everybody but one
    // person boards has nothing to vote about.
    for (let n = 4; n <= 40; n += 1) {
      expect(seatsFor(n)).toBeLessThanOrEqual(n - 2);
    }
  });

  it('keeps all three paths claimable once the room can afford it', () => {
    // The code, the record and the vote each need a seat or a whole phase of
    // the night decides nothing.
    for (let n = 5; n <= 40; n += 1) {
      expect(seatsFor(n)).toBeGreaterThanOrEqual(3);
    }
  });

  it('degrades rather than throwing on rooms too small to be a game', () => {
    expect(seatsFor(0)).toBe(0);
    expect(seatsFor(1)).toBe(1);
    expect(seatsFor(3)).toBe(1);
    expect(seatsFor(4)).toBe(2);
  });

  it('leaves the majority behind once the room is big enough to', () => {
    for (let n = 7; n <= 40; n += 1) {
      expect(seatsFor(n)).toBeLessThan(n / 2);
    }
  });

  it('is deliberately generous to a room of five or six', () => {
    // Three seats out of five is most of the room, and that is the right
    // trade: below seven players the three-seat floor wins over the scarcity
    // ratio, because a five-person game that cannot fill all three paths
    // never exercises the vote at all. Asserted rather than left implicit so
    // nobody "fixes" it into a one-path game.
    expect(seatsFor(5)).toBe(3);
    expect(seatsFor(6)).toBe(3);
  });
});

describe('teamsFor', () => {
  it.each([
    [5, 2],
    [8, 2],
    [12, 3],
    [16, 5],
    [20, 6],
    [24, 7],
  ])('cuts %i players into %i teams', (players, teams) => {
    expect(teamsFor(players)).toBe(teams);
  });

  it('never makes a team of one', () => {
    for (let n = 2; n <= 40; n += 1) {
      expect(Math.min(...teamSizes(n))).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps teams in the threes and fours it is aiming for', () => {
    // Pairs are two people taking turns. Five-plus is a meeting.
    for (let n = 6; n <= 40; n += 1) {
      const sizes = teamSizes(n);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    }
  });

  it('splits the room in two as soon as there are four people', () => {
    // One team holding every puzzle fragment is the failure the split exists
    // to prevent, so two teams is the floor wherever two teams can exist.
    for (let n = 4; n <= 40; n += 1) {
      expect(teamsFor(n)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('teamSizes', () => {
  it('spreads the remainder across the leading teams', () => {
    expect(teamSizes(20, 6)).toEqual([4, 4, 3, 3, 3, 3]);
    expect(teamSizes(5, 2)).toEqual([3, 2]);
    expect(teamSizes(9, 3)).toEqual([3, 3, 3]);
  });

  it('seats everybody exactly once, at every size', () => {
    for (let n = 1; n <= 40; n += 1) {
      const sizes = teamSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('never lets two teams differ by more than one', () => {
    for (let n = 1; n <= 40; n += 1) {
      const sizes = teamSizes(n);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });
});

describe('partitionInto', () => {
  it('keeps the order it is given', () => {
    // The caller shuffles. If this re-ordered too, "who ends up with whom"
    // would be decided in two places.
    expect(partitionInto(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });

  it('loses nobody', () => {
    for (let n = 1; n <= 40; n += 1) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      expect(partitionInto(ids).flat()).toEqual(ids);
    }
  });

  it('is empty for an empty room rather than a team of nobody', () => {
    expect(partitionInto([])).toEqual([]);
  });
});

describe('targetMinutesFor', () => {
  it('gives a bigger room more time, up to an hour', () => {
    expect(targetMinutesFor(5)).toBe(45);
    expect(targetMinutesFor(8)).toBe(45);
    expect(targetMinutesFor(12)).toBe(49);
    expect(targetMinutesFor(20)).toBe(57);
    expect(targetMinutesFor(40)).toBe(60);
  });

  it('never budgets past an hour', () => {
    // Past an hour it is not a game night, whatever the headcount.
    for (let n = 1; n <= 100; n += 1) {
      expect(targetMinutesFor(n)).toBeLessThanOrEqual(60);
    }
  });
});
