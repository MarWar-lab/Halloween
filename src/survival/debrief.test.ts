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

it('names the biggest publisher to the ledger, as a fourth prompt', () => {
  const answers: Answer[] = [ans('a', 0, 1)];
  const names: Record<string, string> = { p1: 'Priya', p2: 'Sam' };
  const ledger = {
    puzzles: [
      { posted: [{ playerId: 'p1' }, { playerId: 'p1' }, { playerId: 'p2' }], askingPlayerIds: [] },
      { posted: [{ playerId: 'p1' }], askingPlayerIds: [] },
    ],
    nameOf: (id: string) => names[id],
  };
  const prompts = buildDebrief(answers, ledger);
  const ledgerPrompt = prompts.find((p) => p.title === 'Who fed the ledger');
  expect(ledgerPrompt?.body).toContain('Priya published 3 fragments');
});

it('says nothing about the ledger when nobody ever posted or asked', () => {
  const ledger = { puzzles: [{ posted: [], askingPlayerIds: [] }], nameOf: () => undefined };
  expect(buildDebrief([ans('a', 0, 1)], ledger).some((p) => p.title === 'Who fed the ledger')).toBe(false);
});

it('names whoever is still waiting on an unanswered ask, even if nobody ever posted', () => {
  const names: Record<string, string> = { dev: 'Dev' };
  const ledger = {
    puzzles: [{ posted: [], askingPlayerIds: ['dev'] }],
    nameOf: (id: string) => names[id],
  };
  const prompts = buildDebrief([ans('a', 0, 1)], ledger);
  const ledgerPrompt = prompts.find((p) => p.title === 'Who fed the ledger');
  expect(ledgerPrompt?.body).toContain('Dev asked the room for a fragment and never got one.');
});

it('reports both facts together when both are true of the same night', () => {
  const names: Record<string, string> = { priya: 'Priya', dev: 'Dev' };
  const ledger = {
    puzzles: [
      { posted: [{ playerId: 'priya' }], askingPlayerIds: [] },
      { posted: [], askingPlayerIds: ['dev'] },
    ],
    nameOf: (id: string) => names[id],
  };
  const body = buildDebrief([ans('a', 0, 1)], ledger).find((p) => p.title === 'Who fed the ledger')?.body;
  expect(body).toContain('Priya published 1 fragment');
  expect(body).toContain('Dev asked the room for a fragment and never got one.');
});

it("never double-counts someone still asking across more than one berth", () => {
  const ledger = {
    puzzles: [
      { posted: [], askingPlayerIds: ['dev'] },
      { posted: [], askingPlayerIds: ['dev'] },
    ],
    nameOf: () => 'Dev',
  };
  const body = buildDebrief([ans('a', 0, 1)], ledger).find((p) => p.title === 'Who fed the ledger')?.body;
  // "Dev" named once, not "Dev and Dev" — the join list is deduplicated by player.
  expect(body?.match(/Dev/g)).toHaveLength(1);
});

it('never mentions the ledger at all when the caller has no puzzle data', () => {
  // The three answer-based prompts must not silently start requiring it.
  const answers: Answer[] = [ans('a', 0, 0), ans('b', 0, 1), ans('c', 0, 2)];
  expect(buildDebrief(answers).some((p) => p.title === 'Who fed the ledger')).toBe(false);
});

it('adds the ledger prompt as a fourth slot rather than displacing the other three', () => {
  const answers: Answer[] = [
    ans('a', 0, 0), ans('b', 0, 1), ans('c', 0, 2),
    ans('a', 1, 3), ans('b', 1, 3), ans('c', 1, 3),
    ans('a', 3, 0), ans('b', 3, 0), ans('c', 3, 1),
  ];
  const ledger = {
    puzzles: [{ posted: [{ playerId: 'a' }], askingPlayerIds: [] }],
    nameOf: () => 'Someone',
  };
  const withLedger = buildDebrief(answers, ledger);
  const withoutLedger = buildDebrief(answers);
  expect(withLedger.length).toBe(withoutLedger.length + 1);
  for (const p of withoutLedger) expect(withLedger.map((x) => x.title)).toContain(p.title);
});

it('names the team carrying the most ruthless marks together, as a fifth prompt', () => {
  const names: Record<string, string> = { a: 'Priya', b: 'Sam', c: 'Cara', d: 'Dev' };
  const team = {
    teams: [
      { id: 't1', memberIds: ['a', 'b'] },
      { id: 't2', memberIds: ['c', 'd'] },
    ],
    ruthless: [
      { playerId: 'a', marks: 3 }, { playerId: 'b', marks: 3 },
      { playerId: 'c', marks: 1 }, { playerId: 'd', marks: 1 },
    ],
    nameOf: (id: string) => names[id],
  };
  const prompts = buildDebrief([ans('a', 0, 1)], undefined, team);
  const teamPrompt = prompts.find((p) => p.title === 'The team that went furthest');
  expect(teamPrompt?.body).toContain('Priya, Sam');
  expect(teamPrompt?.body).toContain('3 marks');
});

it('says nothing about teams when nobody carries a mark', () => {
  const team = {
    teams: [{ id: 't1', memberIds: ['a'] }, { id: 't2', memberIds: ['b'] }],
    ruthless: [{ playerId: 'a', marks: 0 }, { playerId: 'b', marks: 0 }],
    nameOf: () => 'Someone',
  };
  expect(buildDebrief([ans('a', 0, 1)], undefined, team).some((p) => p.title === 'The team that went furthest'))
    .toBe(false);
});

it('says nothing about teams when there is only one team', () => {
  const team = {
    teams: [{ id: 't1', memberIds: ['a', 'b'] }],
    ruthless: [{ playerId: 'a', marks: 2 }, { playerId: 'b', marks: 2 }],
    nameOf: () => 'Someone',
  };
  expect(buildDebrief([ans('a', 0, 1)], undefined, team).some((p) => p.title === 'The team that went furthest'))
    .toBe(false);
});

it('never mentions a team at all when the caller has no team data', () => {
  const answers: Answer[] = [ans('a', 0, 0), ans('b', 0, 1), ans('c', 0, 2)];
  expect(buildDebrief(answers).some((p) => p.title === 'The team that went furthest')).toBe(false);
});

it('adds the team prompt as a fifth slot alongside the ledger prompt, displacing neither', () => {
  const answers: Answer[] = [
    ans('a', 0, 0), ans('b', 0, 1), ans('c', 0, 2),
    ans('a', 1, 3), ans('b', 1, 3), ans('c', 1, 3),
    ans('a', 3, 0), ans('b', 3, 0), ans('c', 3, 1),
  ];
  const ledger = { puzzles: [{ posted: [{ playerId: 'a' }], askingPlayerIds: [] }], nameOf: () => 'Someone' };
  const team = {
    teams: [{ id: 't1', memberIds: ['a'] }, { id: 't2', memberIds: ['b'] }],
    ruthless: [{ playerId: 'a', marks: 1 }, { playerId: 'b', marks: 0 }],
    nameOf: () => 'Someone',
  };
  const withBoth = buildDebrief(answers, ledger, team);
  const withNeither = buildDebrief(answers);
  expect(withBoth.length).toBe(withNeither.length + 2);
  for (const p of withNeither) expect(withBoth.map((x) => x.title)).toContain(p.title);
});
