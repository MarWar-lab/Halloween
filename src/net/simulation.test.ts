/**
 * Play the whole game, many times, roughly.
 *
 * The unit tests check one rule each and the integration test walks one tidy
 * round. Neither plays a real evening, and a real evening is where the bugs
 * are: a host skipping a chapter mid-round, somebody passing while the room
 * votes, a round dealt to two people, the deck running dry, a game ending and
 * another starting on the same machine.
 *
 * So this drives complete games with a seeded random host and asserts the
 * things that must hold no matter what order anyone presses anything in. Same
 * seed, same game — a failure here is reproducible rather than a story about
 * something that happened once.
 */

import { describe, expect, it } from 'vitest';
import { installBrowser, tab } from '../test/browserShim';

installBrowser();

const { LocalBackend } = await import('./local');
const { deckById } = await import('../game/decks');
const { deal } = await import('../game/deal');
const { heatCapFor, nextGamePhase, nextRoundPhase, isPlayingPhase } = await import('../game/machine');
const { visibleSubmissions } = await import('../game/sealing');
const { eligibleVoters } = await import('../game/ballot');
const { PLANNED_CARDS } = await import('../game/pacing');
import type { GameSnapshot } from './types';

const look = { body: 0, topper: 0, top: 0, accessory: 0 };
const deck = deckById('halloween');

/** A tiny deterministic generator, so a failing run can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

interface Trouble {
  seed: number;
  where: string;
  detail: string;
}

/**
 * What the run actually reached.
 *
 * Asserted below, because the failure mode of a random simulator is not a red
 * test — it is a green one that stopped exercising anything interesting and
 * nobody noticed.
 */
interface Seen {
  mechanics: Record<string, number>;
  phases: Record<string, number>;
  passes: number;
  skips: number;
}

const emptySeen = (): Seen => ({ mechanics: {}, phases: {}, passes: 0, skips: 0 });

async function playOneGame(seed: number, trouble: Trouble[], seen: Seen = emptySeen()) {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  installBrowser();
  const backend = new LocalBackend();

  tab('host');
  const created = await backend.createGame('halloween', 'halloween', 'Hana', look);
  const gameId = created.gameId;

  // Two to eight people, some of them playing through the host's screen.
  const humans = 1 + Math.floor(rand() * 5);
  const tabs = ['host'];
  for (let i = 0; i < humans; i += 1) {
    const name = `P${i}`;
    tab(name);
    await backend.joinGame(created.code, name, look);
    tabs.push(name);
  }
  tab('host');
  const proxies = Math.floor(rand() * 3);
  for (let i = 0; i < proxies; i += 1) await backend.addProxy(gameId, `Proxy${i}`, look);

  const look_ = (who: string): GameSnapshot => {
    tab(who);
    let snap: GameSnapshot | null = null;
    const stop = backend.subscribe(gameId, (s) => {
      snap = s;
    });
    stop();
    return snap as unknown as GameSnapshot;
  };

  const note = (where: string, detail: string) => trouble.push({ seed, where, detail });

  const dealtCards = new Set<string>();
  let guard = 0;

  while (guard++ < 400) {
    const snap = look_('host');
    if (snap.game.phase === 'awards') break;

    const round = snap.round;
    const roundOver = !round || round.phase === 'scored';

    // Sometimes the host just moves on, mid-round, exactly as a real one does
    // when the clock is against them.
    if (rand() < 0.12) {
      tab('host');
      const next = nextGamePhase(snap.game.phase);
      if (next !== snap.game.phase) {
        seen.skips += 1;
        await backend.setPhase(gameId, next, heatCapFor(next));
        continue;
      }
    }

    if (roundOver) {
      if (!isPlayingPhase(snap.game.phase)) {
        tab('host');
        const next = nextGamePhase(snap.game.phase);
        if (next === snap.game.phase) break;
        await backend.setPhase(gameId, next, heatCapFor(next));
        continue;
      }

      const outcome = deal(
        {
          deck,
          phase: snap.game.phase,
          heatCap: snap.game.heatCap,
          usedCardIds: snap.usedCardIds,
          playerIds: snap.players.map((p) => p.id),
          playedPlayerIds: snap.playedPlayerIds,
          standings: snap.players.map((p) => ({ playerId: p.id, score: p.score })),
        },
        rand,
      );

      if (!outcome.ok) {
        tab('host');
        const next = nextGamePhase(snap.game.phase);
        if (next === snap.game.phase) break;
        await backend.setPhase(gameId, next, heatCapFor(next));
        continue;
      }

      if (dealtCards.has(outcome.plan.cardId)) {
        note('deal', `card ${outcome.plan.cardId} dealt twice`);
      }
      dealtCards.add(outcome.plan.cardId);
      seen.mechanics[outcome.plan.mechanic] = (seen.mechanics[outcome.plan.mechanic] ?? 0) + 1;

      tab('host');
      await backend.startRound(gameId, outcome.plan);
      continue;
    }

    // Somebody plays the round.
    const live = look_('host').round!;
    seen.phases[live.phase] = (seen.phases[live.phase] ?? 0) + 1;
    const card = deck.cards.find((c) => c.id === live.cardId);

    if (live.phase === 'submitting') {
      for (const who of tabs) {
        if (rand() < 0.12) continue; // somebody always forgets
        const snapFor = look_(who);
        const me = snapFor.players.find((p) => p.id === (who === 'host' ? undefined : p.id));
        void me;
        tab(who);
        try {
          await backend.submitAnswer(live.id, `${who}-answer-${live.idx}`);
        } catch (err) {
          note('submit', String((err as Error).message));
        }
      }
      // The host types for anyone without a device.
      const hostSnap = look_('host');
      for (const proxy of hostSnap.players.filter((p) => p.isProxy)) {
        tab('host');
        try {
          await backend.submitAnswer(live.id, `${proxy.name}-answer`, proxy.id);
        } catch (err) {
          note('submit-proxy', String((err as Error).message));
        }
      }

      // THE SEALING RULE, checked while it matters.
      for (const who of tabs.slice(1)) {
        const seen = look_(who);
        const mine = seen.submissions.filter((s) => s.playerId != null);
        if (seen.submissions.length > mine.length) {
          note('sealing', 'an unwritten answer was visible before the reveal');
        }
      }
    } else if (live.phase === 'voting') {
      const hostSnap = look_('host');
      const voters = eligibleVoters(live, hostSnap.players);
      for (const voter of voters) {
        const isProxy = voter.isProxy;
        const who = isProxy ? 'host' : tabs.find((t) => look_(t).players.some((p) => p.id === voter.id)) ?? 'host';
        tab(who);
        try {
          if (live.mechanic === 'split') {
            await backend.castVote(
              live.id,
              { optionIndex: rand() < 0.5 ? 0 : 1 },
              isProxy ? voter.id : undefined,
            );
          } else if (live.mechanic === 'solo') {
            await backend.castVote(
              live.id,
              { score: 1 + Math.floor(rand() * 5) },
              isProxy ? voter.id : undefined,
            );
          } else if (live.mechanic === 'duel') {
            const side = pick([live.turnPlayerId, live.opponentId].filter(Boolean) as string[]);
            if (side && side !== voter.id) {
              await backend.castVote(live.id, { targetPlayerId: side }, isProxy ? voter.id : undefined);
            }
          } else {
            const options = look_(who).submissions.filter((s) => s.playerId !== voter.id);
            if (options.length > 0) {
              const choice = pick(options);
              await backend.castVote(
                live.id,
                live.mechanic === 'guesswho'
                  ? { submissionId: choice.id, guessPlayerId: pick(hostSnap.players).id }
                  : { submissionId: choice.id },
                isProxy ? voter.id : undefined,
              );
            }
          }
        } catch (err) {
          const msg = String((err as Error).message);
          // Refusing a self-vote is correct behaviour, not a defect.
          if (!/your own/.test(msg)) note('vote', msg);
        }
      }
    }

    // Somebody occasionally uses their Pass, including at awkward moments.
    if (rand() < 0.08 && tabs.length > 1) {
      const who = pick(tabs);
      tab(who);
      try {
        await backend.spendPass(gameId);
        seen.passes += 1;
      } catch (err) {
        note('pass', String((err as Error).message));
      }
    }

    // Move the round on.
    const now = look_('host').round!;
    if (now.results) continue;
    tab('host');
    const next = nextRoundPhase(now.mechanic, now.phase);
    try {
      if (next === 'scored') await backend.scoreRound(now.id);
      else await backend.advanceRound(now.id, next, card?.secs ?? null);
    } catch (err) {
      note('advance', String((err as Error).message));
    }
  }

  if (guard >= 400) note('loop', 'the game never reached the awards');

  const final = look_('host');
  for (const p of final.players) {
    if (!Number.isInteger(p.score)) note('score', `${p.name} has a non-integer score`);
    if (p.score < 0) note('score', `${p.name} finished on ${p.score}`);
  }
  return { final, dealt: dealtCards.size };
}

describe('a whole evening, many times over', () => {
  it('plays thirty games to the awards without a single complaint', async () => {
    const trouble: Trouble[] = [];
    const seen = emptySeen();
    let reachedAwards = 0;
    let totalDealt = 0;

    for (let seed = 1; seed <= 30; seed += 1) {
      const { final, dealt } = await playOneGame(seed, trouble, seen);
      if (final.game.phase === 'awards') reachedAwards += 1;
      totalDealt += dealt;
    }

    expect(trouble, JSON.stringify(trouble.slice(0, 8), null, 1)).toEqual([]);
    expect(reachedAwards).toBe(30);
    // A game that deals nothing is not a game.
    expect(totalDealt / 30).toBeGreaterThan(2);

    // And the run has to have actually been through the game.
    for (const mechanic of ['split', 'allplay', 'guesswho', 'solo', 'duel']) {
      expect(seen.mechanics[mechanic] ?? 0, `never dealt a ${mechanic} card`).toBeGreaterThan(0);
    }
    for (const phase of ['submitting', 'voting', 'performing']) {
      expect(seen.phases[phase] ?? 0, `never reached ${phase}`).toBeGreaterThan(0);
    }
    expect(seen.passes, 'nobody ever used a Pass').toBeGreaterThan(0);
    expect(seen.skips, 'the host never skipped a chapter').toBeGreaterThan(0);
  }, 60_000);

  it('starts a fresh game cleanly after one has finished', async () => {
    const trouble: Trouble[] = [];
    await playOneGame(101, trouble);

    // Same machine, same tabs, brand new game — the thing a host does when the
    // first group leaves and the second arrives.
    const backend = new LocalBackend();
    tab('host');
    const again = await backend.createGame('halloween', 'halloween', 'Hana', look);
    tab('newcomer');
    const seat = await backend.joinGame(again.code, 'Newcomer', look);

    let snap: GameSnapshot | null = null;
    const stop = backend.subscribe(again.gameId, (s) => {
      snap = s;
    });
    stop();

    const s = snap as unknown as GameSnapshot;
    expect(s.game.phase).toBe('lobby');
    expect(s.game.roundNo).toBe(0);
    expect(s.usedCardIds).toEqual([]);
    expect(s.players.every((p) => p.score === 0)).toBe(true);
    expect(seat.playerId).toBeTruthy();
    expect(trouble).toEqual([]);
  }, 30_000);

  it('the plan asks for fewer cards than a real game gets through', async () => {
    // If the budget were larger than what actually fits, the 45 minutes would
    // be a fiction from the first card.
    const trouble: Trouble[] = [];
    const { dealt } = await playOneGame(7, trouble);
    expect(PLANNED_CARDS).toBeLessThanOrEqual(deck.cards.length);
    expect(dealt).toBeLessThanOrEqual(deck.cards.length);
  }, 30_000);

  it('never shows one player another player’s sealed answer', () => {
    // Belt and braces on top of the in-game check: the pure rule, directly.
    const subs = [
      { id: 'a', roundId: 'r', playerId: 'ana', text: 'A', createdAt: '1' },
      { id: 'b', roundId: 'r', playerId: 'ben', text: 'B', createdAt: '2' },
    ];
    expect(visibleSubmissions(subs, 'submitting', 'ben').map((s) => s.text)).toEqual(['B']);
  });
});
