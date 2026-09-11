/**
 * A whole night, played through the real local backend.
 *
 * The seal test proves the sealed values match the database. This proves the
 * rules built on them behave — and it drives the actual backend rather than a
 * mock, because a mock would only ever confirm what the mock believes.
 *
 * The assertions are things a player can see on a screen, so a failure here
 * names a visible bug rather than an internal invariant.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { installBrowser, tab } from '../../test/browserShim';

installBrowser();

const { LocalSurvivalBackend } = await import('./local');
const { SEALED, worstOption } = await import('../sealed');
import type { Snapshot } from '../types';

type Backend = InstanceType<typeof LocalSurvivalBackend>;

/** Read the game as one particular person sees it. */
function seenBy(backend: Backend, who: string, gameId: string): Snapshot {
  tab(who);
  let snap: Snapshot | null = null;
  const stop = backend.subscribe(gameId, (s) => {
    snap = s;
  });
  stop();
  return snap as unknown as Snapshot;
}

const idOf = (snap: Snapshot, name: string) =>
  snap.players.find((p) => p.name === name)!.id;

describe('The Last Screen Standing, through the local backend', () => {
  let backend: Backend;
  let gameId: string;
  let code: string;

  beforeEach(async () => {
    installBrowser();
    backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    gameId = made.gameId;
    code = made.code;
    tab('cara');
    await backend.join(code, 'Cara');
    tab('dev');
    await backend.join(code, 'Dev');
    tab('hana');
    await backend.advance(gameId); // briefing
    await backend.advance(gameId); // running, question 0
  });

  it('refuses a second tap, because a tap is final', async () => {
    tab('cara');
    await backend.answer(gameId, 2);
    await expect(backend.answer(gameId, 0)).rejects.toThrow(/already chosen/i);
  });

  it('will not let anyone choose once the question is open', async () => {
    tab('hana');
    await backend.reveal(gameId);
    tab('cara');
    await expect(backend.answer(gameId, 1)).rejects.toThrow(/already open/i);
  });

  it('gives the worst move to anyone who stayed quiet', async () => {
    tab('cara');
    await backend.answer(gameId, 2);
    tab('hana');
    await backend.reveal(gameId);

    const snap = seenBy(backend, 'dev', gameId);
    const dev = snap.answers.find((a) => a.playerId === idOf(snap, 'Dev'))!;
    expect(dev.optionIndex).toBe(worstOption(0));
    // Flagged, so the phone can say why rather than leaving somebody to
    // conclude the game is broken.
    expect(dev.autoAssigned).toBe(true);
  });

  it('keeps your percentage yours', async () => {
    tab('cara');
    await backend.answer(gameId, 2);
    tab('hana');
    await backend.reveal(gameId);

    const cara = seenBy(backend, 'cara', gameId);
    expect(cara.myScores).toEqual([{ questionIdx: 0, survivalPct: SEALED[0][2].survivalPct }]);

    // The whole game rests on this line. Dev is in the same room, at the same
    // moment, and there is nothing of Cara's in what he was sent — not a
    // masked field, not a null, nothing.
    const dev = seenBy(backend, 'dev', gameId);
    expect(dev.myScores).toHaveLength(1);
    expect(dev.myScores[0].survivalPct).toBe(SEALED[0][worstOption(0)].survivalPct);
    expect(JSON.stringify(dev)).not.toContain(`"survivalPct":${SEALED[0][2].survivalPct}`);
  });

  it('shows who chose what only once the question is open', async () => {
    tab('cara');
    await backend.answer(gameId, 2);

    // Before: Dev can see his own row and nobody else's.
    expect(seenBy(backend, 'dev', gameId).answers).toHaveLength(0);

    tab('hana');
    await backend.reveal(gameId);
    expect(seenBy(backend, 'dev', gameId).answers).toHaveLength(3);
  });

  it('backfills a late arrival so nobody has a gap', async () => {
    tab('hana');
    await backend.reveal(gameId);
    await backend.advance(gameId); // question 1
    await backend.reveal(gameId);

    tab('lee');
    await backend.join(code, 'Lee');
    const snap = seenBy(backend, 'lee', gameId);
    const lee = snap.answers.filter((a) => a.playerId === idOf(snap, 'Lee'));

    expect(lee.map((a) => a.questionIdx).sort()).toEqual([0, 1]);
    expect(lee.every((a) => a.autoAssigned)).toBe(true);
    expect(lee.map((a) => a.optionIndex)).toEqual([worstOption(0), worstOption(1)]);
  });

  it('holds every rate back until the tribunal', async () => {
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId); // → plea

    expect(seenBy(backend, 'cara', gameId).standings).toBeNull();

    tab('hana');
    await backend.advance(gameId); // → tribunal
    const open = seenBy(backend, 'cara', gameId);
    expect(open.standings).not.toBeNull();
    expect(open.standings).toHaveLength(3);
  });

  it('seals a plea while it is being written and attributes it after', async () => {
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId); // → plea

    tab('cara');
    await backend.plea(gameId, 'I have the passcodes');
    // Dev is still writing his own and must not be reading hers.
    expect(seenBy(backend, 'dev', gameId).pleas).toHaveLength(0);

    tab('hana');
    await backend.advance(gameId); // → tribunal
    const seen = seenBy(backend, 'dev', gameId);
    expect(seen.pleas).toHaveLength(1);
    // Attributed, deliberately: an anonymous tribunal is not a tribunal.
    expect(seen.pleas[0].playerId).toBe(idOf(seen, 'Cara'));
  });

  it('refuses a vote for yourself', async () => {
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId);
    await backend.advance(gameId); // → tribunal
    const snap = seenBy(backend, 'cara', gameId);
    tab('cara');
    await expect(backend.vote(gameId, idOf(snap, 'Cara'))).rejects.toThrow(/yourself/i);
  });

  it('breaks a tied vote with the higher survival rate', async () => {
    // Cara takes the best move every time; the other two never answer at all,
    // so they collect the worst. Then all three tie on one vote each.
    await playOut(backend, gameId, 'cara');
    tab('hana');
    await backend.advance(gameId);
    await backend.advance(gameId); // → tribunal

    const snap = seenBy(backend, 'cara', gameId);
    const [hana, cara, dev] = ['Hana', 'Cara', 'Dev'].map((n) => idOf(snap, n));
    tab('cara'); await backend.vote(gameId, dev);
    tab('dev'); await backend.vote(gameId, hana);
    tab('hana'); await backend.vote(gameId, cara);
    await backend.advance(gameId); // → result

    const done = seenBy(backend, 'dev', gameId);
    expect(done.votes).toHaveLength(3);
    expect(done.winner).toHaveLength(1);
    expect(done.winner![0].playerId).toBe(cara);
    expect(done.winner![0].votes).toBe(1);
  });
});

/** Run every question to the end, optionally letting one person play well. */
async function playOut(backend: Backend, gameId: string, best?: string) {
  for (let q = 0; q < SEALED.length; q += 1) {
    if (best) {
      const pcts = SEALED[q].map((m) => m.survivalPct);
      tab(best);
      await backend.answer(gameId, pcts.indexOf(Math.max(...pcts)));
    }
    tab('hana');
    await backend.reveal(gameId);
    if (q < SEALED.length - 1) await backend.advance(gameId);
  }
}
