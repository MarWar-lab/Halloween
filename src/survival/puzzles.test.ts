/**
 * The puzzles, checked as properties rather than as examples.
 *
 * A generated puzzle cannot be eyeballed — there are thousands of them, one
 * per berth per game — so the things that must be true of every single one
 * are asserted over many seeds. Two of them are load-bearing:
 *
 *   - it has exactly one answer, or the room argues about a wrong digit;
 *   - no single team can already name it, or the fragments do not actually
 *     need to be traded across the room and the whole mechanic is theatre.
 */

import { describe, expect, it } from 'vitest';
import { buildPuzzle, clockOf, dealPuzzle, noTeamSolves, ruleText, satisfies, survivors } from './puzzles';
import { partitionInto, teamsFor } from './scale';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const ROOMS = [3, 4, 5, 8, 12, 20];

describe('every generated puzzle', () => {
  it('has exactly one line that survives every rule', () => {
    for (const players of ROOMS) {
      for (const seed of SEEDS) {
        const puzzle = buildPuzzle(1 + (seed % 4), seed % 10, players, seed);
        const left = survivors(puzzle);
        expect(left, `players=${players} seed=${seed}`).toHaveLength(1);
      }
    }
  });

  it('answers with the digit it was asked to hide', () => {
    for (const players of ROOMS) {
      for (const seed of SEEDS) {
        const digit = seed % 10;
        const puzzle = buildPuzzle(1 + (seed % 4), digit, players, seed);
        expect(survivors(puzzle)[0].seal, `players=${players} seed=${seed}`).toBe(digit);
      }
    }
  });

  it('needs every one of its key rules, and nothing else', () => {
    // Drop a key rule and the board must go ambiguous — that is what makes
    // it key. Drop anything else and nothing may change, which is what lets
    // a player go quiet without stranding the room.
    for (const players of ROOMS) {
      for (const seed of SEEDS) {
        const puzzle = buildPuzzle(1 + (seed % 4), seed % 10, players, seed);
        const without = (i: number) => ({
          lines: puzzle.lines,
          rules: puzzle.rules.filter((_, j) => j !== i),
        });
        for (let i = 0; i < puzzle.rules.length; i += 1) {
          const key = puzzle.keyRuleIndices.includes(i);
          const left = survivors(without(i)).length;
          if (key) expect(left, `key rule ${i}, players=${players} seed=${seed}`).toBeGreaterThan(1);
          else expect(left, `spare rule ${i}, players=${players} seed=${seed}`).toBe(1);
        }
      }
    }
  });

  it('leaves no team able to solve it alone', () => {
    // The claim the whole design rests on: if one team's fragments narrow
    // the board to a single line, that team walks out without speaking to
    // anybody and the puzzle stops being a reason to negotiate.
    for (const players of ROOMS) {
      if (teamsFor(players) < 2) continue; // nothing to spread across
      for (const seed of SEEDS) {
        const roster = Array.from({ length: players }, (_, i) => `p${i}`);
        const teams = partitionInto(roster, teamsFor(players));
        const puzzle = buildPuzzle(1 + (seed % 4), seed % 10, players, seed);
        const fragments = dealPuzzle(puzzle, teams, seed);

        // Re-express the deal as indices into puzzle.rules, which is what
        // noTeamSolves reads.
        const heldBy = new Map(fragments.map((f) => [f.playerId, f.rule]));
        const dealt = { ...puzzle, rules: roster.map((id) => heldBy.get(id)!) };
        const byIndex = teams.map((team) => team.map((id) => roster.indexOf(id)));

        expect(fragments, `players=${players} seed=${seed}`).toHaveLength(players);
        expect(noTeamSolves(dealt, byIndex), `players=${players} seed=${seed}`).toBe(true);
        // And the room as a whole still gets there.
        expect(survivors(dealt), `players=${players} seed=${seed}`).toHaveLength(1);
      }
    }
  });

  it('deals exactly one fragment to every player', () => {
    for (const players of ROOMS) {
      expect(buildPuzzle(2, 7, players, 99).rules).toHaveLength(players);
    }
  });

  it('never lets a wrong line carry the right digit', () => {
    // A decoy sharing the answer's seal would make the deduction optional:
    // guess any line, read off the same number, walk away.
    for (const players of ROOMS) {
      for (const seed of SEEDS) {
        const digit = seed % 10;
        const puzzle = buildPuzzle(1 + (seed % 4), digit, players, seed);
        const wrong = puzzle.lines.filter((l) => l.id !== puzzle.answerLineId);
        expect(wrong.some((l) => l.seal === digit), `players=${players} seed=${seed}`).toBe(false);
      }
    }
  });

  it('is reproducible from its seed, and different between berths', () => {
    // Reproducible because a backend that regenerates on every read would
    // change the puzzle under the room mid-negotiation.
    expect(buildPuzzle(3, 4, 8, 7)).toEqual(buildPuzzle(3, 4, 8, 7));
    expect(buildPuzzle(3, 4, 8, 7)).not.toEqual(buildPuzzle(3, 4, 8, 8));
  });

  it('puts five lines on the board, however many people are holding rules', () => {
    for (const players of ROOMS) {
      expect(buildPuzzle(1, 0, players, 5).lines).toHaveLength(5);
      expect(new Set(buildPuzzle(1, 0, players, 5).lines.map((l) => l.id)).size).toBe(5);
    }
  });

  it('works at both ends of the digit range', () => {
    // 0 and 9 are where the seal nudge that avoids a duplicate wraps around.
    for (const digit of [0, 9]) {
      for (const seed of SEEDS.slice(0, 50)) {
        const puzzle = buildPuzzle(2, digit, 8, seed);
        expect(survivors(puzzle), `digit=${digit} seed=${seed}`).toHaveLength(1);
        expect(survivors(puzzle)[0].seal).toBe(digit);
      }
    }
  });
});

describe('the fragments a player actually reads', () => {
  it('renders every rule kind as a sentence, with no leftover placeholder', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (const rule of buildPuzzle(1 + (seed % 4), seed % 10, 20, seed).rules) seen.add(rule.kind);
    }
    // Every kind the generator can emit has to have prose, or somebody holds
    // a blank fragment and cannot trade it.
    for (const seed of SEEDS) {
      for (const rule of buildPuzzle(1 + (seed % 4), seed % 10, 20, seed).rules) {
        const text = ruleText(rule);
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/undefined|NaN|\[object/);
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('prints a clock a person can read', () => {
    expect(clockOf(0)).toBe('00:00');
    expect(clockOf(9 * 60 + 5)).toBe('09:05');
    expect(clockOf(23 * 60 + 59)).toBe('23:59');
  });

  it('agrees with itself about what a rule means', () => {
    const line = { id: 1, berth: 2, seal: 4, signedAt: 1200, signer: 'CUSTOMS' };
    expect(satisfies({ kind: 'sealParity', even: true }, line)).toBe(true);
    expect(satisfies({ kind: 'sealParity', even: false }, line)).toBe(false);
    expect(satisfies({ kind: 'berthIs', berth: 2 }, line)).toBe(true);
    expect(satisfies({ kind: 'berthIsNot', berth: 2 }, line)).toBe(false);
    expect(satisfies({ kind: 'signedBefore', minutes: 1201 }, line)).toBe(true);
    expect(satisfies({ kind: 'signedAfter', minutes: 1200 }, line)).toBe(false);
    expect(satisfies({ kind: 'signerIs', signer: 'CUSTOMS' }, line)).toBe(true);
  });
});
