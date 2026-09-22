import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClipStage } from './ClipStage';
import { QUESTIONS } from '../questions';
import type { Snapshot } from '../types';

const base = (over: Partial<Snapshot['game']> = {}): Snapshot['game'] => ({
  id: 'game', code: 'TEST', hostUserId: 'host', phase: 'running',
  questionIdx: 0, revealed: false, createdAt: '', mode: 'solo', ruthlessEnabled: true, ...over,
});

const snap = (game: Snapshot['game'], answers: Snapshot['answers'] = []): Snapshot => ({
  game, players: [], answers, myScores: [], pleas: [], votes: [],
  answeredPlayerIds: [], pleadedPlayerIds: [], votedPlayerIds: [],
  reveal: null, standings: null, seats: null, clue: null, clueSeer: null,
  escapedPlayerIds: [], retryInSeconds: 0, teamAttempts: 0, ruthless: null,
  keyReveal: null, myTeam: null, teams: null, seatCount: 3, puzzles: [],
});

it('renders nothing outside the running phase', () => {
  for (const phase of ['lobby', 'briefing', 'plea', 'tribunal', 'result'] as const) {
    const html = renderToStaticMarkup(<ClipStage snapshot={snap(base({ phase }))} me="Hana" />);
    expect(html).toBe('');
  }
});

it('renders nothing on a warm-up — neither carries a clip', () => {
  for (const questionIdx of [-2, -1]) {
    const html = renderToStaticMarkup(<ClipStage snapshot={snap(base({ questionIdx }))} me="Hana" />);
    expect(html).toBe('');
  }
});

it("plays every real question's own clip", () => {
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const html = renderToStaticMarkup(<ClipStage snapshot={snap(base({ questionIdx: i }))} me="Hana" />);
    expect(html, `question ${i}`).toContain(`src="${QUESTIONS[i].clip}"`);
  }
});

it('reads as "choosing" before anyone has answered', () => {
  const html = renderToStaticMarkup(<ClipStage snapshot={snap(base())} me="Hana" />);
  expect(html).toContain('data-beat="choosing"');
});

it('reads as "locked" once my own answer exists but the round has not opened', () => {
  const answers = [{ playerId: 'Hana', questionIdx: 0, optionIndex: 2, autoAssigned: false }];
  const html = renderToStaticMarkup(<ClipStage snapshot={snap(base(), answers)} me="Hana" />);
  expect(html).toContain('data-beat="locked"');
});

it("does not read as locked from a TEAMMATE's answer alone — only mine counts", () => {
  const answers = [{ playerId: 'Cara', questionIdx: 0, optionIndex: 2, autoAssigned: false }];
  const html = renderToStaticMarkup(<ClipStage snapshot={snap(base(), answers)} me="Hana" />);
  expect(html).toContain('data-beat="choosing"');
});

it('reads as "revealed" once the round opens, regardless of my own answer', () => {
  const html = renderToStaticMarkup(<ClipStage snapshot={snap(base({ revealed: true }))} me="Hana" />);
  expect(html).toContain('data-beat="revealed"');
});

it('is aria-hidden and never intercepts a tap', () => {
  const html = renderToStaticMarkup(<ClipStage snapshot={snap(base())} me="Hana" />);
  expect(html).toContain('aria-hidden="true"');
});
