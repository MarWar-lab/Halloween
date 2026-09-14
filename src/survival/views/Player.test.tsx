import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from './Player';
import type { Snapshot } from '../types';
import type { Survival } from '../state/useSurvival';

const snapshot = (phase: Snapshot['game']['phase']): Snapshot => ({
  game: { id: 'game', code: 'TEST', hostUserId: 'host', phase, questionIdx: 6, revealed: true, createdAt: '' },
  players: ['Hana', 'Cara'].map((name) => ({ id: name, name, gameId: 'game', userId: name, lastSeen: '' })),
  answers: [], myScores: [{ questionIdx: 0, survivalPct: 65 }], pleas: [], votes: [],
  answeredPlayerIds: [], pleadedPlayerIds: ['Hana'], votedPlayerIds: ['Hana'],
  reveal: null, standings: null, winner: [{ playerId: 'Hana', name: 'Hana', votes: 1, average: 65 }],
});
const render = (phase: Snapshot['game']['phase']) => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/survive?net=local' } });
  return renderToStaticMarkup(<Player survival={{ busy: false } as Survival}
    snapshot={snapshot(phase)} me="Hana" isHost />);
};
afterEach(() => vi.unstubAllGlobals());

it('names the missing plea before the host closes submissions', () => {
  expect(render('plea')).toContain('Open without 1 plea');
});
it('names the missing vote before the host counts', () => {
  expect(render('tribunal')).toContain('Count without 1 vote');
});
it('does not offer a dead Finished button or claim the final rate is private', () => {
  const html = render('result');
  expect(html).not.toContain('Finished');
  expect(html).not.toContain('Nobody else can see this');
  expect(html).toContain('The tribunal has opened');
});
it('opens a separate screen without copying the local host identity', () => {
  const html = render('lobby');
  expect(html).toContain('c=TEST');
  expect(html).toContain('screen=1');
  expect(html).toContain('noopener');
});
