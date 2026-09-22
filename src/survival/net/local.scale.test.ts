/**
 * A 20-player night, played through the real local backend — the top end of
 * the stated headcount range.
 *
 * Everything below this scale is already exercised one question at a time
 * by local.game.test.ts (2-5 players), and seatsFor/teamsFor/the puzzle
 * generator each have their own property tests up to and including 20
 * players in scale.test.ts and puzzles.test.ts. What none of those cover is
 * this backend's own wiring at that headcount — dealPuzzles, team drawing
 * and seat allocation all running end to end through survival_advance's
 * local twin, on a room nobody plays through by hand.
 */

import { describe, expect, it } from 'vitest';
import { installBrowser, tab } from '../../test/browserShim';

installBrowser();

const { LocalSurvivalBackend } = await import('./local');
const { INTRO_QUESTIONS, QUESTIONS } = await import('../questions');
const { seatsFor, teamsFor, teamSizes, targetMinutesFor } = await import('../scale');
const { satisfies } = await import('../puzzles');
const { pacingFor } = await import('../pacing');
import type { Rule, ManifestLine } from '../puzzles';
import type { Snapshot } from '../types';

type Backend = InstanceType<typeof LocalSurvivalBackend>;

function seenBy(backend: Backend, who: string, gameId: string): Snapshot {
  tab(who);
  let snap: Snapshot | null = null;
  const stop = backend.subscribe(gameId, (s) => {
    snap = s;
  });
  stop();
  return snap as unknown as Snapshot;
}

interface RawDoc {
  teams: { id: string; memberIds: string[] }[];
  puzzles: { berth: number; lines: ManifestLine[]; answerLineId: number }[];
  fragments: { berth: number; playerId: string; rule: Rule }[];
}

function docOf(gameId: string): RawDoc {
  return JSON.parse(localStorage.getItem(`survival:game:${gameId}`)!) as RawDoc;
}

/** Mirrors GREEN_BERTHS in local.ts — which round unlocks which berth's puzzle. */
const GREEN_BERTHS = QUESTIONS.flatMap((q, idx) =>
  q.manifest?.color === 'green' ? [{ berth: q.manifest.berth, questionIdx: idx }] : [],
);

const PLAYER_COUNT = 20;
const NAMES = Array.from({ length: PLAYER_COUNT }, (_, i) => `P${i}`);

describe('a 20-player night', () => {
  it('scales seats, teams, the puzzle deal and the pacing budget the way the plan promises', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab(NAMES[0]);
    const made = await backend.create(NAMES[0]);
    for (const name of NAMES.slice(1)) {
      tab(name);
      await backend.join(made.code, name);
    }

    tab(NAMES[0]);
    await backend.advance(made.gameId); // briefing — teams and puzzles are dealt here

    // Teams: 6 teams of 3-4, never a lone straggler and never more than half
    // the room's worth of teams.
    const doc = docOf(made.gameId);
    const sizes = [...doc.teams.map((t) => t.memberIds.length)].sort((a, b) => a - b);
    const expectedSizes = [...teamSizes(PLAYER_COUNT)].sort((a, b) => a - b);
    expect(doc.teams).toHaveLength(teamsFor(PLAYER_COUNT));
    expect(sizes).toEqual(expectedSizes);
    expect(doc.teams.every((t) => t.memberIds.length >= 2)).toBe(true);
    expect(new Set(doc.teams.flatMap((t) => t.memberIds)).size).toBe(PLAYER_COUNT);

    // Seats: a fifth of the room, not the flat three every smaller game uses.
    const atBriefing = seenBy(backend, NAMES[0], made.gameId);
    expect(atBriefing.seatCount).toBe(seatsFor(PLAYER_COUNT));
    expect(atBriefing.seatCount).toBeGreaterThan(3);

    // Pacing: the same budget shape as any room, stretched for this one —
    // never silently falling back to the 8-player reference.
    const pacing = pacingFor(
      { phase: atBriefing.game.phase, questionIdx: atBriefing.game.questionIdx, createdAt: atBriefing.game.createdAt },
      PLAYER_COUNT,
    );
    expect(pacing.minutesTarget).toBe(targetMinutesFor(PLAYER_COUNT));
    expect(pacing.minutesTarget).toBeGreaterThan(targetMinutesFor(8));

    tab(NAMES[0]);
    await backend.advance(made.gameId); // running — first warm-up
    for (let i = 0; i < INTRO_QUESTIONS.length; i += 1) {
      tab(NAMES[0]);
      await backend.reveal(made.gameId);
      await backend.advance(made.gameId);
    }

    const unlockedAt = new Map(GREEN_BERTHS.map((g) => [g.questionIdx, g.berth]));
    for (let q = 0; q < QUESTIONS.length; q += 1) {
      // Checked at the exact round a berth opens: every one of the twenty
      // holds something, nobody arrives to an empty hand — the single
      // point of failure a lone late joiner used to hit, now checked at
      // the scale where a dealing bug is most likely to only show up.
      const newBerth = unlockedAt.get(q);
      if (newBerth !== undefined) {
        for (const name of NAMES) {
          const mine = seenBy(backend, name, made.gameId).puzzles.find((p) => p.berth === newBerth);
          expect(mine?.myRule, `${name}, berth ${newBerth}`).not.toBeNull();
        }
      }
      tab(NAMES[0]);
      await backend.reveal(made.gameId);
      if (q < QUESTIONS.length - 1) await backend.advance(made.gameId);
    }

    // No team's dealt fragments alone narrow any berth to one line — the
    // real backend's own seed (hashSeed(gameId:berth)), not the pure
    // property test's arbitrary seeds, and the real per-game team roster
    // rather than a synthetic partition.
    const finalDoc = docOf(made.gameId);
    for (const puzzle of finalDoc.puzzles) {
      for (const team of finalDoc.teams) {
        const held = finalDoc.fragments
          .filter((f) => f.berth === puzzle.berth && team.memberIds.includes(f.playerId))
          .map((f) => f.rule);
        const surviving = puzzle.lines.filter((line) => held.every((rule) => satisfies(rule, line)));
        expect(surviving.length, `berth ${puzzle.berth}, team ${team.id}`).toBeGreaterThan(1);
      }
    }

    tab(NAMES[0]);
    await backend.advance(made.gameId); // → plea
    await backend.advance(made.gameId); // → tribunal
    await backend.advance(made.gameId); // → result

    const final = seenBy(backend, NAMES[0], made.gameId);
    expect(final.game.phase).toBe('result');
    expect(final.seatCount).toBe(seatsFor(PLAYER_COUNT));
    expect(final.seats).not.toBeNull();
    expect(final.seats!.length).toBeGreaterThan(0);
    expect(final.ruthless).toHaveLength(PLAYER_COUNT);
  });
});
