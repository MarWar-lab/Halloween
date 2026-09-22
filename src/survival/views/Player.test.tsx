import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from './Player';
import type { Snapshot } from '../types';
import type { Survival } from '../state/useSurvival';

const base = (phase: Snapshot['game']['phase']): Snapshot => ({
  game: {
    id: 'game', code: 'TEST', hostUserId: 'host', phase, questionIdx: 6, revealed: true, createdAt: '',
    mode: 'solo', ruthlessEnabled: true,
  },
  players: ['Hana', 'Cara'].map((name) => ({ id: name, name, gameId: 'game', userId: name, lastSeen: '' })),
  answers: [], myScores: [{ questionIdx: 0, survivalPct: 65 }], pleas: [], votes: [],
  answeredPlayerIds: [], pleadedPlayerIds: ['Hana'], votedPlayerIds: ['Hana'],
  reveal: null, standings: null,
  seats: [{ playerId: 'Hana', name: 'Hana', seat: 1, path: 'vote', votes: 1, average: 65, solveOrder: null, contested: false }],
  clue: null, clueSeer: null, escapedPlayerIds: [], retryInSeconds: 0, teamAttempts: 0,
  ruthless: null, keyReveal: null, myTeam: null, teams: null, seatCount: 3, puzzles: [],
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
  expect(html).toContain('The room voted Hana aboard');
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

it('does not offer "1 seats" when the room is small enough to play for one', () => {
  // The header was written when SEATS was a constant three. seatsFor makes it
  // one for a room of three or four, and the copy has to survive that.
  const one = { ...base('tribunal'), seatCount: 1 };
  expect(render(one)).toContain('1 seat.');
  expect(render(one)).not.toContain('1 seats');
  expect(render({ ...base('tribunal'), seatCount: 3 })).toContain('3 seats.');
});

it('tells the room what the code was, once it no longer matters', () => {
  // survival_key_reveal has returned this at `result` since the extraction
  // puzzle shipped and nothing ever rendered it, so a room that failed to
  // crack the code never found out what it was.
  const done = { ...base('result'), keyReveal: { code: '4821', recipe: 'Berth 4 down to berth 1.' } };
  const html = render(done);
  expect(html).toContain('4821');
  expect(html).toContain('Berth 4 down to berth 1.');
  // And nothing leaks it before the helicopter has lifted.
  expect(render(base('tribunal'))).not.toContain('4821');
});

it('never tells a solver they have a seat before the seat list exists', () => {
  // A real playtest proved this false: with a capped escape-path budget, the
  // second person to state the correct code can genuinely end the night with
  // no seat at all, even though the old copy told them "you are on the
  // chopper" the moment their guess was accepted.
  const snap = base('plea');
  snap.escapedPlayerIds = ['Cara', 'Hana'];
  const html = render(snap);
  expect(html).toContain('2nd to crack it');
  expect(html).toContain('Whether it wins you a seat is decided at the tribunal');
  expect(html).not.toContain('You are on the chopper');
  expect(html).not.toContain('Seat 2');
});

it('names a teammate who also stated the code, but not twice', () => {
  const snap = base('plea');
  snap.escapedPlayerIds = ['Hana', 'Cara'];
  snap.myTeam = ['Hana', 'Cara'];
  const html = render(snap);
  expect(html).toContain('Cara stated it too');
  // The "also stated it" line is for non-teammates; Cara is a teammate and
  // is only named once, in the teammate line above.
  expect(html).not.toContain('Also stated it');
});

it('shows the host a pacing line once the lobby closes, but not before', () => {
  // pacing.ts existed, was tested, and was never imported anywhere outside
  // its own test file — a real indicator on paper, dead code in the app.
  const briefing = base('briefing');
  briefing.game.createdAt = new Date().toISOString();
  const html = render(briefing);
  expect(html).toMatch(/\d+ of \d+ min/);
  expect(render(base('lobby'))).not.toMatch(/\d+ of \d+ min/);
});

it('marks the host behind once the night has genuinely overrun', () => {
  const late = base('running');
  late.game.questionIdx = 0;
  // Ten hours ago is behind at any phase, any room size.
  late.game.createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
  const html = render(late);
  expect(html).toContain('running long');
});

it('shows who fed the ledger, on the result screen, from public post data', () => {
  const snap = base('result');
  snap.standings = [{ playerId: 'Hana', name: 'Hana', rounds: 7, average: 65 }];
  snap.puzzles = [
    {
      berth: 1, lines: [], myRule: null, myRulePosted: false,
      posted: [{ playerId: 'Hana', text: 'Only berth 1 was still loading.' }],
      askingPlayerIds: [], digit: 1, firstSolvedBy: 'Hana',
    },
  ];
  const html = render(snap);
  expect(html).toContain('Who fed the ledger');
  expect(html).toContain('Hana published 1 fragment');
});

it('shows the host every team, not just the viewer\'s own', () => {
  const snap = base('briefing');
  snap.game.mode = 'consensus';
  snap.teams = [
    { id: 'team-1', memberIds: ['Hana', 'Cara'] },
  ];
  snap.myTeam = ['Hana', 'Cara'];
  const html = render(snap, true);
  expect(html).toContain('Team 1:');
  expect(html).toContain('Hana');
  expect(html).toContain('Cara');
});

it('shows the host no team roster in solo mode', () => {
  const snap = base('briefing');
  snap.teams = null;
  const html = render(snap, true);
  expect(html).not.toContain('team-roster');
});

it('gives the board a per-team average once standings open, from figures it already prints', () => {
  const snap = base('tribunal');
  snap.teams = [{ id: 'team-1', memberIds: ['Hana', 'Cara'] }];
  snap.standings = [
    { playerId: 'Hana', name: 'Hana', rounds: 7, average: 60 },
    { playerId: 'Cara', name: 'Cara', rounds: 7, average: 40 },
  ];
  const html = render(snap);
  expect(html).toContain('By team');
  expect(html).toContain('Team 1: Hana, Cara');
  // (60 + 40) / 2 = 50
  expect(html).toContain('50%');
});

it('shows no team row before standings are public, even with teams drawn', () => {
  const snap = base('plea');
  snap.teams = [{ id: 'team-1', memberIds: ['Hana', 'Cara'] }];
  snap.standings = null;
  const html = render(snap);
  expect(html).not.toContain('By team');
});
