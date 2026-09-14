import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from './Player';
import type { Snapshot } from '../types';
import type { Survival } from '../state/useSurvival';

const base = (phase: Snapshot['game']['phase']): Snapshot => ({
  game: { id: 'game', code: 'TEST', hostUserId: 'host', phase, questionIdx: 6, revealed: true, createdAt: '' },
  players: ['Hana', 'Cara'].map((name) => ({ id: name, name, gameId: 'game', userId: name, lastSeen: '' })),
  answers: [], myScores: [{ questionIdx: 0, survivalPct: 65 }], pleas: [], votes: [],
  answeredPlayerIds: [], pleadedPlayerIds: ['Hana'], votedPlayerIds: ['Hana'],
  reveal: null, standings: null, winner: [{ playerId: 'Hana', name: 'Hana', votes: 1, average: 65 }],
});
const render = (snapshot: Snapshot, isHost = true) => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/survive?net=local', host: 'localhost' } });
  return renderToStaticMarkup(<Player survival={{ busy: false } as Survival}
    snapshot={snapshot} me="Hana" isHost={isHost} />);
};
afterEach(() => vi.unstubAllGlobals());

it('names the missing plea before the host closes submissions', () => {
  expect(render(base('plea'))).toContain('Open without 1 plea');
});
it('names the missing vote before the host counts', () => {
  expect(render(base('tribunal'))).toContain('Count without 1 vote');
});
it('shows everyone\'s rate at the result, not a stale private-only line', () => {
  const snap = base('result');
  snap.standings = [{ playerId: 'Hana', name: 'Hana', rounds: 7, average: 65 }];
  const html = render(snap);
  expect(html).not.toContain('Finished');
  expect(html).not.toContain('Nobody else can see this');
  // The board carries the reveal now — every player's row, attributed.
  expect(html).toContain('Hana takes the seat');
  expect(html).toContain('board-row');
  expect(html).toContain('>65%<');
});
it('shows the room code big in the lobby, with no separate screen to open', () => {
  const html = render(base('lobby'));
  expect(html).toContain('code-badge');
  expect(html).toContain('>TEST<');
  expect(html).not.toContain('shared screen');
  expect(html).not.toContain('screen=1');
});
it('shows the briefing text once the lobby closes', () => {
  const html = render({ ...base('briefing') });
  expect(html).toContain('The world ends on a Tuesday');
});
it('shows the scenario text before a question is answered, not just the choices', () => {
  const snap = base('running');
  snap.game.questionIdx = 0;
  snap.game.revealed = false;
  const html = render(snap);
  expect(html).toContain('epicentre');
});
it('opens every outcome on reveal, not just your own', () => {
  const snap = base('running');
  snap.game.questionIdx = 0;
  snap.game.revealed = true;
  snap.answers = [{ playerId: 'Cara', questionIdx: 0, optionIndex: 2, autoAssigned: false }];
  snap.reveal = [0, 1, 2, 3, 4].map((optionIndex) => ({
    optionIndex, label: `move ${optionIndex}`, outcome: `outcome ${optionIndex}`, takers: optionIndex === 2 ? 1 : 0,
  }));
  const html = render(snap);
  for (const i of [0, 1, 2, 3, 4]) expect(html).toContain(`outcome ${i}`);
  expect(html).toContain('Cara');
  expect(html).toContain('keep your own percentage to yourself');
});
it('opens a warm-up\'s outcomes from the public question text, not the sealed reveal', () => {
  const snap = base('running');
  snap.game.questionIdx = -2;
  snap.game.revealed = true;
  snap.reveal = null;
  const html = render(snap);
  expect(html).toContain('Priorities');
  // No percentage exists for a warm-up, and nothing here should imply one.
  expect(html).not.toContain('Talk it out — and keep');
});
it('shows a private recap before the plea composer, then the composer after continuing', () => {
  const snap = base('plea');
  snap.answers = [{ playerId: 'Hana', questionIdx: 0, optionIndex: 2, autoAssigned: false }];
  snap.myScores = [{ questionIdx: 0, survivalPct: 75 }];
  const html = render(snap);
  expect(html).toContain('Before you plead your case');
  expect(html).toContain('75%');
  expect(html).not.toContain('Why should we take YOU');
});
it('shows the board of everyone\'s case above the vote, before and after voting', () => {
  const snap = base('tribunal');
  snap.standings = [{ playerId: 'Hana', name: 'Hana', rounds: 7, average: 65 }];
  snap.pleas = [{ playerId: 'Hana', text: 'I have the passcodes' }];
  const html = render(snap);
  expect(html).toContain('I have the passcodes');
  expect(html).toContain('>65%<');
});
