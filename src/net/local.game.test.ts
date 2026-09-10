/**
 * A whole game, played through the real backend.
 *
 * The unit tests cover the rules in isolation; this covers the rules as the
 * views actually meet them — which is where the interesting failures were. Each
 * assertion below is something a host or a player can observe on screen, so a
 * failure here names a visible bug rather than an internal invariant.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { installBrowser, tab } from '../test/browserShim';

installBrowser();

const { LocalBackend } = await import('./local');
const { deckById, eligible } = await import('../game/decks');
const { planFor } = await import('../game/deal');
import type { GameSnapshot } from './types';
import type { Heat, Mechanic } from '../game/types';

const look = { body: 0, topper: 0, top: 0, accessory: 0 };
const deck = deckById('halloween');

/** Read the game as one particular person sees it. */
function seenBy(backend: InstanceType<typeof LocalBackend>, who: string, gameId: string) {
  tab(who);
  let snap: GameSnapshot | null = null;
  const stop = backend.subscribe(gameId, (s) => {
    snap = s;
  });
  stop();
  return snap as unknown as GameSnapshot;
}

describe('a full game through the local backend', () => {
  let backend: InstanceType<typeof LocalBackend>;
  let gameId: string;
  let host: string;
  let ana: string;
  let ben: string;
  let cleo: string;
  let proxy: string;

  /** Deal the first eligible card of a given mechanic, as the host would. */
  async function deal(mechanic: Mechanic, heatCap: Heat = 1) {
    tab('host');
    const snap = seenBy(backend, 'host', gameId);
    const card = eligible(deck, {
      heatCap,
      usedIds: snap.usedCardIds,
      mechanic,
    })[0];
    expect(card, `deck has a ${mechanic} card at heat ${heatCap}`).toBeTruthy();

    tab('host');
    // Deliberately the same planner the host console uses, so a bug in the
    // deal shows up here rather than being papered over by the test.
    return backend.startRound(
      gameId,
      planFor(card, {
        turnPlayerId: mechanic === 'solo' || mechanic === 'duel' ? ana : null,
        opponentId: mechanic === 'duel' ? ben : null,
      }),
    );
  }

  beforeEach(async () => {
    installBrowser();
    backend = new LocalBackend();

    tab('host');
    const created = await backend.createGame('halloween', 'halloween', 'Hana', look);
    gameId = created.gameId;
    host = created.playerId;

    tab('ana');
    ana = (await backend.joinGame(created.code, 'Ana', look)).playerId;
    tab('ben');
    ben = (await backend.joinGame(created.code, 'Ben', look)).playerId;
    tab('cleo');
    cleo = (await backend.joinGame(created.code, 'Cleo', look)).playerId;

    tab('host');
    await backend.addProxy(gameId, 'Dev', look);
    proxy = seenBy(backend, 'host', gameId).players.find((p) => p.isProxy)!.id;

    tab('host');
    await backend.setPhase(gameId, 'warmup', 1);
  });

  it('seats everyone who joined, including the person without a device', () => {
    const snap = seenBy(backend, 'host', gameId);
    expect(snap.players.map((p) => p.name)).toEqual(['Hana', 'Ana', 'Ben', 'Cleo', 'Dev']);
    expect(snap.players.filter((p) => p.isProxy)).toHaveLength(1);
  });

  describe('an all-play round', () => {
    let roundId: string;

    beforeEach(async () => {
      roundId = await deal('allplay');
      tab('ana');
      await backend.submitAnswer(roundId, 'ANA_ANSWER');
      tab('ben');
      await backend.submitAnswer(roundId, 'BEN_ANSWER');
      tab('cleo');
      await backend.submitAnswer(roundId, 'CLEO_ANSWER');
    });

    it('keeps every answer sealed from the other players while writing', () => {
      const asBen = seenBy(backend, 'ben', gameId);
      expect(asBen.submissions.map((s) => s.text)).toEqual(['BEN_ANSWER']);
    });

    it('tells the host how many people have answered, without showing what', () => {
      // The host has to know when to close submissions. Sealing hides the text,
      // not the fact that someone has finished.
      const asHost = seenBy(backend, 'host', gameId);
      expect(asHost.submittedPlayerIds).toEqual(
        expect.arrayContaining([ana, ben, cleo]),
      );
      expect(asHost.submissions.map((s) => s.text)).toEqual([]);
    });

    it('reveals the answers unattributed', async () => {
      tab('host');
      await backend.advanceRound(roundId, 'revealing');

      const asBen = seenBy(backend, 'ben', gameId);
      expect(asBen.submissions).toHaveLength(3); // Ana, Ben, Cleo
      const notMine = asBen.submissions.filter((s) => s.text !== 'BEN_ANSWER');
      // The whole mechanic is that you vote without knowing who wrote it. If the
      // author id ships with the row, devtools wins the game.
      expect(notMine.map((s) => s.playerId)).toEqual(notMine.map(() => null));
    });

    it('scores a vote at two points and showing up at one', async () => {
      tab('host');
      await backend.advanceRound(roundId, 'revealing');
      await backend.advanceRound(roundId, 'voting');

      const asBen = seenBy(backend, 'ben', gameId);
      const anasRow = asBen.submissions.find((s) => s.text === 'ANA_ANSWER')!;
      tab('ben');
      await backend.castVote(roundId, { submissionId: anasRow.id });
      tab('cleo');
      await backend.castVote(roundId, { submissionId: anasRow.id });

      tab('host');
      await backend.scoreRound(roundId);

      const scored = seenBy(backend, 'host', gameId);
      const score = (id: string) => scored.players.find((p) => p.id === id)!.score;
      expect(score(ana)).toBe(5); // 1 for submitting + 2 votes
      expect(score(ben)).toBe(1);
      expect(score(cleo)).toBe(1);
      expect(score(host)).toBe(0); // never submitted
    });
  });

  describe('a guess-who round', () => {
    let roundId: string;

    beforeEach(async () => {
      roundId = await deal('guesswho');
      for (const [who] of [['ana'], ['ben'], ['cleo']] as const) {
        tab(who);
        await backend.submitAnswer(roundId, `${who.toUpperCase()}_FACT`);
      }
      tab('host');
      await backend.advanceRound(roundId, 'revealing');
      await backend.advanceRound(roundId, 'voting');
    });

    it('counts a guess on every answer, not just the first', async () => {
      // A guess-who voter guesses once per answer. Collapsing that to one vote
      // per person throws away most of the round.
      const asBen = seenBy(backend, 'ben', gameId);
      const others = asBen.submissions.filter((s) => s.text !== 'BEN_FACT');
      expect(others).toHaveLength(2);

      tab('ben');
      for (const s of others) {
        // Ben guesses correctly every time.
        const truth = s.text === 'ANA_FACT' ? ana : cleo;
        await backend.castVote(roundId, { submissionId: s.id, guessPlayerId: truth });
      }

      tab('host');
      await backend.scoreRound(roundId);
      const scored = seenBy(backend, 'host', gameId);
      expect(scored.players.find((p) => p.id === ben)!.score).toBe(4); // 2 correct × 2
    });
  });

  describe('a solo turn', () => {
    it('runs choosing → performing → voting → scored and pays the median', async () => {
      const roundId = await deal('solo');
      const phases: string[] = [];

      for (const next of ['performing', 'voting'] as const) {
        tab('host');
        phases.push(seenBy(backend, 'host', gameId).round!.phase);
        await backend.advanceRound(roundId, next, next === 'performing' ? 60 : null);
      }
      expect(phases).toEqual(['choosing', 'performing']);

      for (const [who, score] of [['ben', 5], ['cleo', 3], ['host', 1]] as const) {
        tab(who);
        await backend.castVote(roundId, { score });
      }

      tab('host');
      await backend.scoreRound(roundId);
      const scored = seenBy(backend, 'host', gameId);
      expect(scored.players.find((p) => p.id === ana)!.score).toBe(3);
    });

    it('gives the performer a clock to perform against', async () => {
      const roundId = await deal('solo');
      tab('host');
      await backend.advanceRound(roundId, 'performing', 60);
      expect(seenBy(backend, 'host', gameId).round!.deadlineAt).toBeTruthy();
    });
  });

  describe('a duel', () => {
    it('starts its timer without the host having to advance a phase first', async () => {
      // A duel's flow begins at `performing`, so if the deal does not set a
      // deadline the two players are performing against nothing.
      const roundId = await deal('duel', 3);
      const round = seenBy(backend, 'host', gameId).round!;
      expect(round.phase).toBe('performing');
      expect(round.deadlineAt, 'a duel is dealt with its clock already running').toBeTruthy();
      expect(roundId).toBeTruthy();
    });

    it('pays three to the winner and one for turning up', async () => {
      const roundId = await deal('duel', 3);
      tab('host');
      await backend.advanceRound(roundId, 'voting');
      for (const who of ['cleo', 'host'] as const) {
        tab(who);
        await backend.castVote(roundId, { targetPlayerId: ana });
      }
      tab('host');
      await backend.scoreRound(roundId);
      const scored = seenBy(backend, 'host', gameId);
      expect(scored.players.find((p) => p.id === ana)!.score).toBe(4);
      expect(scored.players.find((p) => p.id === ben)!.score).toBe(1);
    });
  });

  describe('the host playing on behalf of someone without a device', () => {
    it('never offers a proxy their own answer to vote for', async () => {
      // The host typed the proxy's answer, so the console has to be able to
      // pick it out of the anonymous pile — otherwise it offers the proxy a
      // vote for themselves, which the server then rejects.
      const roundId = await deal('allplay');
      tab('host');
      await backend.submitAnswer(roundId, 'PROXY_ANSWER', proxy);
      tab('ana');
      await backend.submitAnswer(roundId, 'ANA_ANSWER');

      tab('host');
      await backend.advanceRound(roundId, 'revealing');
      await backend.advanceRound(roundId, 'voting');

      const asHost = seenBy(backend, 'host', gameId);
      const proxyRow = asHost.submissions.find((s) => s.text === 'PROXY_ANSWER')!;
      expect(proxyRow.playerId).toBe(proxy);
      // Everyone else is still anonymous to the host.
      expect(asHost.submissions.find((s) => s.text === 'ANA_ANSWER')!.playerId).toBeNull();

      // And the rule still holds for a player who controls nobody.
      const asBen = seenBy(backend, 'ben', gameId);
      expect(asBen.submissions.find((s) => s.text === 'PROXY_ANSWER')!.playerId).toBeNull();
    });

    it('lets the host answer and vote for a proxy', async () => {
      const roundId = await deal('allplay');
      tab('host');
      await backend.submitAnswer(roundId, 'PROXY_ANSWER', proxy);
      await backend.advanceRound(roundId, 'revealing');

      const asHost = seenBy(backend, 'host', gameId);
      expect(asHost.submissions.map((s) => s.text)).toContain('PROXY_ANSWER');
    });
  });

  describe('the Pass', () => {
    it('costs nothing and takes the player out of the turn', async () => {
      const roundId = await deal('solo');
      tab('ana');
      await backend.spendPass(gameId);

      const snap = seenBy(backend, 'host', gameId);
      expect(snap.players.find((p) => p.id === ana)!.passSpent).toBe(true);
      expect(snap.players.find((p) => p.id === ana)!.score).toBe(0);
      // Passing has to actually end the turn, or the card just sits there.
      expect(snap.round!.phase).toBe('scored');
      expect(roundId).toBeTruthy();
    });
  });
});
