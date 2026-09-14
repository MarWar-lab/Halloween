/**
 * The seal, kept honest.
 *
 * public.survival_options is the authority. src/survival/sealed.ts is a copy
 * that exists only so the local backend can run a game with no database. Data
 * duplicated in two places is a kind of drift this repo has not had before —
 * silent, and it produces wrong scores rather than an error — so the copy is
 * checked against the original on every run.
 *
 * The last test here is the structural one: sealed.ts must be imported by the
 * local backend and by this file and by nothing else. That is what guarantees
 * the real backend never reads a percentage out of the bundle, whatever
 * anybody adds later.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUTCOME_MAX, SEALED, worstOption } from './sealed';
import { INTRO_QUESTIONS, QUESTIONS } from './questions';

const root = join(import.meta.dirname, '../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260912090000_survival.sql'),
  'utf8',
);

interface SeedRow {
  questionIdx: number;
  optionIndex: number;
  label: string;
  survivalPct: number;
  outcome: string;
}

/** The seed rows, read out of the migration exactly as Postgres would see them. */
function seedRows(): SeedRow[] {
  const seed = migration.split('insert into public.survival_options')[1] ?? '';
  const row = /\((\d+),\s*(\d+),\s*'((?:[^']|'')*)',\s*(\d+),\s*\n\s*'((?:[^']|'')*)'\)/g;
  const rows: SeedRow[] = [];
  for (const m of seed.matchAll(row)) {
    rows.push({
      questionIdx: Number(m[1]),
      optionIndex: Number(m[2]),
      label: m[3].replace(/''/g, "'"),
      survivalPct: Number(m[4]),
      outcome: m[5].replace(/''/g, "'"),
    });
  }
  return rows;
}

/** Every .ts/.tsx file under src/, so a new one cannot quietly opt out. */
function sourceFiles(dir = join(root, 'src')): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('the sealed values', () => {
  const rows = seedRows();

  it('parses every seeded row out of the migration', () => {
    // If this fails the regex has stopped matching the file, and every other
    // test below is comparing against nothing and passing for free.
    expect(rows).toHaveLength(7 * 5);
  });

  it('matches src/survival/sealed.ts exactly', () => {
    for (const row of rows) {
      const mine = SEALED[row.questionIdx]?.[row.optionIndex];
      expect(mine, `question ${row.questionIdx} move ${row.optionIndex}`).toBeDefined();
      expect(mine.survivalPct).toBe(row.survivalPct);
      expect(mine.outcome).toBe(row.outcome);
    }
  });

  it('and the public labels match the sealed ones', () => {
    // The phone renders the label from questions.ts and joins the migration's
    // row on option_index alone, so a drift here shows up as a red test rather
    // than as a reveal displaying a move nobody was offered.
    for (const row of rows) {
      expect(QUESTIONS[row.questionIdx].choices[row.optionIndex]).toBe(row.label);
    }
  });

  it('has five moves on every question and no orphans', () => {
    expect(SEALED).toHaveLength(QUESTIONS.length);
    for (const moves of SEALED) expect(moves).toHaveLength(5);
  });

  it('keeps the prose short enough for five of them to fit on one screen', () => {
    for (const moves of SEALED) {
      for (const move of moves) expect(move.outcome.length).toBeLessThanOrEqual(OUTCOME_MAX);
    }
  });

  it('never states a duration', () => {
    // The host reads this aloud. A line that says "for twenty minutes" dates
    // the joke to a runtime the game does not have and cannot keep.
    const duration = /\b\d+\s*(second|minute|hour|day|week|month|year)s?\b/i;
    for (const moves of SEALED) {
      for (const move of moves) expect(move.outcome).not.toMatch(duration);
    }
    for (const q of QUESTIONS) expect(q.setup).not.toMatch(duration);
  });

  it('agrees with the database about which move is worst', () => {
    // worstOption drives the local backend's auto-assignment; the SQL has its
    // own copy in survival_worst_option. They pick by lowest percentage, then
    // by lowest index, and a disagreement would punish different people in
    // the two backends for the same silence.
    for (let q = 0; q < SEALED.length; q += 1) {
      const lowest = Math.min(...SEALED[q].map((m) => m.survivalPct));
      const expected = SEALED[q].findIndex((m) => m.survivalPct === lowest);
      expect(worstOption(q)).toBe(expected);
    }
  });
});

/**
 * The two warm-ups carry no SEALED entry at all — that's the point, there is
 * nothing to hide — but they still have to be structurally sound: five
 * choices, five matching outcomes, the same length cap and duration rule as
 * everything else the host reads aloud.
 */
describe('the warm-ups', () => {
  it('have exactly five choices and five outcomes each', () => {
    for (const q of INTRO_QUESTIONS) {
      expect(q.choices).toHaveLength(5);
      expect(q.outcomes, `${q.title} is missing its outcomes`).toBeDefined();
      expect(q.outcomes).toHaveLength(5);
    }
  });

  it('carry no clip and no percentage of any kind', () => {
    // No footage matches an icebreaker, and there is nothing for a warm-up to
    // score — a clip or a survivalPct-shaped field here would be a sign this
    // question drifted into gauntlet territory by accident.
    for (const q of INTRO_QUESTIONS) expect(q.clip).toBeUndefined();
  });

  it('keep their flavour text within the same on-screen budget', () => {
    for (const q of INTRO_QUESTIONS) {
      for (const outcome of q.outcomes!) expect(outcome.length).toBeLessThanOrEqual(OUTCOME_MAX);
    }
  });

  it('never state a duration either', () => {
    const duration = /\b\d+\s*(second|minute|hour|day|week|month|year)s?\b/i;
    for (const q of INTRO_QUESTIONS) {
      expect(q.setup).not.toMatch(duration);
      for (const outcome of q.outcomes!) expect(outcome).not.toMatch(duration);
    }
  });
});

describe('sealed data stays behind the local backend source boundary', () => {
  it('keeps every outcome out of every file but sealed.ts', () => {
    const allowed = new Set([
      join(root, 'src/survival/sealed.ts'),
      join(root, 'src/survival/seal.test.ts'),
    ]);
    const outcomes = seedRows().map((r) => r.outcome);
    for (const file of sourceFiles()) {
      if (allowed.has(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const outcome of outcomes) {
        expect(text.includes(outcome), `${file} contains sealed prose`).toBe(false);
      }
    }
  });

  it('is imported by the local backend and nothing else', () => {
    // The structural guarantee. The Supabase backend must never read a
    // percentage out of the bundle — it asks the database, which is the only
    // place the real answer lives.
    const importers = sourceFiles().filter((file) => {
      if (file.endsWith('seal.test.ts') || file.endsWith('sealed.ts')) return false;
      return /from '\.{1,2}\/(survival\/)?sealed'/.test(readFileSync(file, 'utf8'));
    });
    expect(importers.map((f) => f.slice(root.length + 1))).toEqual([
      'src/survival/net/local.ts',
    ]);
  });
});
