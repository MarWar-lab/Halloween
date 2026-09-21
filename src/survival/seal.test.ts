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
import {
  DARK_CHOICES,
  EXTRACTION,
  EXTRACTION_BRIEF,
  INTRO_QUESTIONS,
  QUESTIONS,
  RUTHLESS_LIMIT,
  SETUP_MAX,
  marksOf,
} from './questions';

const root = join(import.meta.dirname, '../..');
const migrationsDir = join(root, 'supabase/migrations');

interface SeedRow {
  questionIdx: number;
  optionIndex: number;
  label: string;
  survivalPct: number;
  outcome: string;
}

/**
 * The seed rows, composed exactly the way Postgres actually gets them: every
 * migration touching `survival_options`, in filename (chronological) order,
 * each `insert ... on conflict do update` applied on top of the last.
 *
 * The first migration seeded seven questions; a later one reseeded all nine
 * at their current positions; a later one still rewrote two of those in
 * place without moving them. Reading only "the latest reseed" broke the
 * moment that last kind of migration existed — a content-only update that
 * touches existing rows without a wholesale reseed. Scanning every file that
 * mentions the table, in order, is what keeps this test the authority no
 * matter which shape the next migration takes.
 */
function seedRows(): SeedRow[] {
  const byKey = new Map<string, SeedRow>();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const row = /\((\d+),\s*(\d+),\s*'((?:[^']|'')*)',\s*(\d+),\s*\n\s*'((?:[^']|'')*)'\)/g;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const stmt of sql.split(/;\s*(?=\n|$)/)) {
      if (!/insert into\s+public\.survival_options/i.test(stmt)) continue;
      for (const m of stmt.matchAll(row)) {
        const seedRow: SeedRow = {
          questionIdx: Number(m[1]),
          optionIndex: Number(m[2]),
          label: m[3].replace(/''/g, "'"),
          survivalPct: Number(m[4]),
          outcome: m[5].replace(/''/g, "'"),
        };
        // Last migration to touch a (question, option) pair wins — the same
        // "on conflict do update" behaviour every one of these seeds uses.
        byKey.set(`${seedRow.questionIdx}:${seedRow.optionIndex}`, seedRow);
      }
    }
  }
  return [...byKey.values()];
}

/** The (question_idx, option_index) pairs the dark-choice migration flags, parsed the same declarative way `seedRows()` parses the percentage seed. */
function darkSeed(): [number, number][] {
  const file = readdirSync(migrationsDir).find((f) => f.includes('survival_dark'));
  if (!file) return [];
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  const body = sql.match(/set ruthless = true[\s\S]*?in \(([\s\S]*?)\)\s*;/)?.[1] ?? '';
  return [...body.matchAll(/\((\d+),\s*(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
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
    // test below is comparing against nothing and passing for free. Against
    // QUESTIONS.length rather than a literal, so this stays true the next
    // time a question is inserted rather than silently passing for free.
    expect(rows).toHaveLength(QUESTIONS.length * 5);
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

/**
 * The extraction code's content: which rounds carry a real (green) clue,
 * which carry a decoy (red), and which carry nothing at all. Fixed content,
 * identical every game — the per-game secret is only the digits, generated
 * in SQL/local.ts, never here.
 */
describe('the extraction manifest', () => {
  it('has exactly four green rounds, three red decoys, and two carrying nothing', () => {
    const green = QUESTIONS.filter((q) => q.manifest?.color === 'green');
    const red = QUESTIONS.filter((q) => q.manifest?.color === 'red');
    const blank = QUESTIONS.filter((q) => !q.manifest);
    expect(green).toHaveLength(4);
    expect(red).toHaveLength(3);
    expect(blank).toHaveLength(2);
  });

  it('gives every berth 1-4 exactly one green round, and at least one red decoy shares a berth with a green one', () => {
    const green = QUESTIONS.filter((q) => q.manifest?.color === 'green');
    expect(green.map((q) => q.manifest!.berth).sort()).toEqual([1, 2, 3, 4]);

    const greenBerths = new Set(green.map((q) => q.manifest!.berth));
    const redBerths = QUESTIONS.filter((q) => q.manifest?.color === 'red').map((q) => q.manifest!.berth);
    // A naive "note the first digit you see per berth" strategy has to fail
    // on at least one berth, or the decoys are purely decorative.
    expect(redBerths.some((b) => greenBerths.has(b))).toBe(true);
  });

  it('the briefing and the finale reminder never state a duration', () => {
    const duration = /\b\d+\s*(second|minute|hour|day|week|month|year)s?\b/i;
    expect(EXTRACTION_BRIEF).not.toMatch(duration);
    expect(EXTRACTION.rule).not.toMatch(duration);
  });

  it('keeps every setup within budget now that some carry a manifest line too', () => {
    for (const q of QUESTIONS) expect(q.setup.length).toBeLessThanOrEqual(SETUP_MAX);
  });
});

/**
 * The ruthlessness trap: which choices are dark, and the threshold that
 * disqualifies a seat. Cross-checked against the migration seed exactly the
 * way the percentages are, so the two backends can never quietly disagree
 * about who lives.
 */
describe('the ruthlessness trap', () => {
  const darkPairs = darkSeed();

  it('parses a non-empty dark-choice seed out of the migration', () => {
    // Same free "did the regex break" guard the percentage seed test gives
    // itself — if this is empty, every test below is comparing to nothing.
    expect(darkPairs.length).toBeGreaterThan(0);
  });

  it('DARK_CHOICES matches the migration seed exactly, in both directions', () => {
    const fromTs = new Set<string>();
    QUESTIONS.forEach((_, qi) => (DARK_CHOICES[qi] ?? []).forEach((oi) => fromTs.add(`${qi}:${oi}`)));
    const fromSql = new Set(darkPairs.map(([qi, oi]) => `${qi}:${oi}`));
    expect([...fromTs].sort()).toEqual([...fromSql].sort());
  });

  it('every dark index names a choice that actually exists, on a real (non-negative) question', () => {
    DARK_CHOICES.forEach((options, qi) => {
      for (const oi of options) expect(QUESTIONS[qi]?.choices[oi]).toBeDefined();
    });
  });

  it('the threshold is reachable, and a strict majority of the rounds that carry a dark option', () => {
    // Reachable: a future edit that leaves fewer dark rounds than the
    // threshold would make disqualification impossible, silently.
    // Majority: half exactly would be reachable by an ordinary run of
    // pragmatic picks, which is the one thing this trap must not be.
    const roundsWithDark = DARK_CHOICES.filter((options) => options.length > 0).length;
    expect(RUTHLESS_LIMIT).toBeLessThanOrEqual(roundsWithDark);
    expect(RUTHLESS_LIMIT).toBeGreaterThan(roundsWithDark / 2);
  });

  it('marksOf never counts an auto-assigned answer or a warm-up round', () => {
    const [qi, oi] = darkPairs[0];
    const answers = [
      { playerId: 'a', questionIdx: qi, optionIndex: oi, autoAssigned: true },
      { playerId: 'a', questionIdx: -1, optionIndex: oi, autoAssigned: false },
    ];
    expect(marksOf(answers, 'a')).toBe(0);
  });

  it('marksOf does count a real, deliberate dark pick', () => {
    const [qi, oi] = darkPairs[0];
    const answers = [{ playerId: 'a', questionIdx: qi, optionIndex: oi, autoAssigned: false }];
    expect(marksOf(answers, 'a')).toBe(1);
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
