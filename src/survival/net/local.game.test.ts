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
const { DARK_CHOICES, INTRO_QUESTIONS } = await import('../questions');
import { SEATS } from '../types';
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
    await backend.advance(gameId); // running — the first warm-up, question_idx negative
    await skipWarmups(backend, gameId); // every test below assumes it starts at question 0
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
    expect(snap.myScores).toEqual([0, 1].map((q) => ({
      questionIdx: q, survivalPct: SEALED[q][worstOption(q)].survivalPct,
    })));
    await backend.join(code, 'Lee');
    expect(seenBy(backend, 'lee', gameId).myScores).toHaveLength(2);
  });

  it('restores the host seat and rejects a deleted local room', async () => {
    tab('hana');
    const before = await backend.resume(gameId);
    const joined = await backend.join(code, 'Hana');
    expect(await backend.resume(gameId)).toEqual({ playerId: joined.playerId, isHost: true });
    expect(joined.playerId).toBe(before.playerId);
    localStorage.removeItem(`survival:game:${gameId}`);
    await expect(backend.resume(gameId)).rejects.toThrow(/gone/i);
  });

  it.each([NaN, 1.5, -1, 5])('rejects invalid move %s before writing an answer', async (move) => {
    tab('cara');
    await expect(backend.answer(gameId, move)).rejects.toThrow(/five moves/i);
    expect(seenBy(backend, 'cara', gameId).answers).toHaveLength(0);
  });

  it('rejects votes for someone outside the room', async () => {
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId);
    await backend.advance(gameId);
    tab('cara');
    await expect(backend.vote(gameId, 'missing-player')).rejects.toThrow(/not in this game/i);
    expect(seenBy(backend, 'cara', gameId).votedPlayerIds).toHaveLength(0);
  });

  it('gives a tribunal arrival every real score and a correct standing', async () => {
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId);
    await backend.advance(gameId);
    tab('lee');
    const joined = await backend.join(code, 'Lee');
    const snap = seenBy(backend, 'lee', gameId);
    expect(snap.myScores).toHaveLength(SEALED.length);
    const lee = snap.standings!.find((s) => s.playerId === joined.playerId)!;
    expect(lee.rounds).toBe(SEALED.length);
    expect(lee.average).toBe(snap.standings!.find((s) => s.name === 'Hana')!.average);
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
    // Three clean players, three seats — everyone fills one. The tie is still
    // broken, just visible in the ORDER (seat 1 goes to the best precise
    // odds) rather than in who gets a seat at all.
    expect(done.seats).toHaveLength(3);
    expect(done.seats!.every((s) => s.path === 'vote')).toBe(true);
    expect(done.seats![0].playerId).toBe(cara);
    expect(done.seats![0].seat).toBe(1);
    expect(done.seats![0].votes).toBe(1);
  });

  it('ranks and breaks ties on the unrounded odds, not the displayed ones', async () => {
    // Geometric mean spreads odds across a legible range, but two different
    // precise values can still land on the same rounded display by
    // coincidence. Written directly rather than played through real rounds:
    // the point here is the arithmetic on already-scored rows.
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId); // → plea
    await backend.advance(gameId); // → tribunal

    const snap = seenBy(backend, 'hana', gameId);
    const [hana, cara] = ['Hana', 'Cara'].map((n) => idOf(snap, n));
    const doc = JSON.parse(localStorage.getItem(`survival:game:${gameId}`)!);
    doc.scores = doc.scores.filter((s: { playerId: string }) => s.playerId !== hana && s.playerId !== cara);
    // sqrt(0.63 * 0.65) ≈ 63.992% precise, rounds to 64.0%.
    [63, 65].forEach((survivalPct, i) => doc.scores.push({ playerId: hana, questionIdx: i, survivalPct }));
    // sqrt(0.64 * 0.64) = 64.0% precise exactly — same rounded figure, still ahead underneath.
    [64, 64].forEach((survivalPct, i) => doc.scores.push({ playerId: cara, questionIdx: i, survivalPct }));
    localStorage.setItem(`survival:game:${gameId}`, JSON.stringify(doc));

    const standings = seenBy(backend, 'hana', gameId).standings!;
    const [hanaRow, caraRow] = [
      standings.find((s) => s.playerId === hana)!,
      standings.find((s) => s.playerId === cara)!,
    ];
    expect(hanaRow.average).toBe(64);
    expect(caraRow.average).toBe(64);
    // Displayed identically, and still correctly ordered underneath it.
    expect(standings.findIndex((s) => s.playerId === cara))
      .toBeLessThan(standings.findIndex((s) => s.playerId === hana));

    tab('cara'); await backend.vote(gameId, hana);
    tab('hana'); await backend.vote(gameId, cara);
    tab('dev'); await backend.vote(gameId, cara);
    tab('hana'); await backend.advance(gameId); // → result

    const seats = seenBy(backend, 'dev', gameId).seats!;
    expect(seats[0].playerId).toBe(cara);
    expect(seats[0].seat).toBe(1);
  });
});

describe('the two warm-ups', () => {
  it('carry no stakes at all', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running — first warm-up

    const started = seenBy(backend, 'hana', made.gameId);
    expect(started.game.questionIdx).toBe(-INTRO_QUESTIONS.length);

    tab('cara');
    await backend.answer(made.gameId, 1);
    tab('hana');
    await backend.reveal(made.gameId);

    const revealed = seenBy(backend, 'cara', made.gameId);
    // Who chose what is exactly as public as it is for a real question.
    expect(revealed.answers.filter((a) => a.questionIdx === started.game.questionIdx)).toHaveLength(1);
    // But nothing was ever at stake: no figure, for anyone, ever.
    expect(revealed.myScores).toHaveLength(0);
  });

  it('never auto-assign a silent player, unlike a real question', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running — first warm-up, nobody answers
    await backend.reveal(made.gameId);

    // Contrast with "gives the worst move to anyone who stayed quiet" above,
    // which is exactly this assertion but for a real question — there, both
    // players get an answer row; here, since there is nothing at stake,
    // silence just stays silence.
    const snap = seenBy(backend, 'hana', made.gameId);
    expect(snap.answers).toHaveLength(0);
  });

  it('are skipped by a late joiner, unlike a real question', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('hana');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running — first warm-up
    await backend.reveal(made.gameId);
    await backend.advance(made.gameId); // second warm-up
    await backend.reveal(made.gameId);
    await backend.advance(made.gameId); // question 0

    tab('lee');
    await backend.join(made.code, 'Lee');
    const snap = seenBy(backend, 'lee', made.gameId);
    // A late joiner is backfilled for every revealed REAL question so nobody
    // has a gap in their average — but there is no average here to protect,
    // so a warm-up simply isn't backfilled at all.
    expect(snap.answers).toHaveLength(0);
  });
});

/** Read this backend's own generated puzzle straight out of localStorage — the same shortcut the odds test above already takes for `doc.scores`. */
function docOf(gameId: string): { keyCode: string; attempts: { playerId: string; at: number; correct: boolean }[] } {
  return JSON.parse(localStorage.getItem(`survival:game:${gameId}`)!);
}

/** Push every one of a player's attempt timestamps far enough into the past that the cooldown has plainly elapsed. */
function clearCooldown(gameId: string, playerId: string) {
  const doc = docOf(gameId) as unknown as { attempts: { playerId: string; at: number }[] };
  for (const a of doc.attempts) if (a.playerId === playerId) a.at = 0;
  localStorage.setItem(`survival:game:${gameId}`, JSON.stringify(doc));
}

describe('the extraction code', () => {
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
    await backend.advance(gameId); // running — first warm-up
    await skipWarmups(backend, gameId);
    await playOut(backend, gameId);
    tab('hana');
    await backend.advance(gameId); // → plea
  });

  it('never lets a wrong guess reveal the code, to the guesser or to anyone else', async () => {
    tab('cara');
    const result = await backend.escape(gameId, '0000');
    expect(result.accepted).toBe(false);

    const real = docOf(gameId).keyCode;
    if ('0000' === real) throw new Error('test fixture collided with the real code — rerun');
    const mine = seenBy(backend, 'cara', gameId);
    expect(JSON.stringify(mine)).not.toContain(real);
    const dev = seenBy(backend, 'dev', gameId);
    expect(JSON.stringify(dev)).not.toContain(real);
    // Dev's own cooldown must be untouched by Cara's wrong guess.
    expect(dev.retryInSeconds).toBe(0);
  });

  it('never locks a player out — a wrong guess only costs a short cooldown', async () => {
    tab('cara');
    const wrong = await backend.escape(gameId, '0000');
    expect(wrong.accepted).toBe(false);
    expect(seenBy(backend, 'cara', gameId).retryInSeconds).toBeGreaterThan(0);
    // Immediately trying again, still cooling down, is refused without being
    // recorded as a real guess.
    await expect(backend.escape(gameId, '1111')).rejects.toThrow(/resetting/i);

    clearCooldown(gameId, idOf(seenBy(backend, 'cara', gameId), 'Cara'));
    expect(seenBy(backend, 'cara', gameId).retryInSeconds).toBe(0);
    const right = await backend.escape(gameId, docOf(gameId).keyCode);
    expect(right.accepted).toBe(true);
  });

  it('races players in submission order, and every viewer sees the same order', async () => {
    const real = docOf(gameId).keyCode;
    tab('cara');
    await backend.escape(gameId, real);
    tab('dev');
    await backend.escape(gameId, real);
    tab('hana');
    await backend.escape(gameId, real);

    const [hana, cara, dev] = ['Hana', 'Cara', 'Dev'].map((n) => idOf(seenBy(backend, 'hana', gameId), n));
    for (const who of ['hana', 'cara', 'dev']) {
      expect(seenBy(backend, who, gameId).escapedPlayerIds).toEqual([cara, dev, hana]);
    }
  });

  it('seats all three clean solvers by the code alone, once all three have solved', async () => {
    const real = docOf(gameId).keyCode;
    for (const who of ['cara', 'dev', 'hana']) {
      tab(who);
      await backend.escape(gameId, real);
    }
    tab('hana');
    await backend.advance(gameId); // → tribunal
    await backend.advance(gameId); // → result

    const seats = seenBy(backend, 'hana', gameId).seats!;
    expect(seats).toHaveLength(3);
    expect(seats.every((s) => s.path === 'escape')).toBe(true);
  });

  it('skips a disqualified first solver — the seat passes to the next solver', async () => {
    const real = docOf(gameId).keyCode;
    const snap = seenBy(backend, 'hana', gameId);
    const [hana, cara] = ['Hana', 'Cara'].map((n) => idOf(snap, n));

    // Give Hana five non-auto ruthless picks directly — every question that
    // carries a dark option, all in one write, exactly the shortcut the odds
    // test above takes for scores.
    const doc = JSON.parse(localStorage.getItem(`survival:game:${gameId}`)!);
    doc.answers = doc.answers.filter((a: { playerId: string }) => a.playerId !== hana);
    for (const q of [0, 1, 2, 3, 4]) {
      doc.answers.push({ playerId: hana, questionIdx: q, optionIndex: DARK_CHOICES[q][0], autoAssigned: false });
    }
    localStorage.setItem(`survival:game:${gameId}`, JSON.stringify(doc));

    tab('hana');
    await backend.escape(gameId, real); // solves first, but is disqualified
    tab('cara');
    await backend.escape(gameId, real); // solves second
    tab('hana');
    await backend.advance(gameId); // → tribunal
    await backend.advance(gameId); // → result

    const final = seenBy(backend, 'dev', gameId);
    expect(final.escapedPlayerIds[0]).toBe(hana); // solved first...
    expect(final.seats!.some((s) => s.playerId === hana)).toBe(false); // ...but refused a seat
    expect(final.seats!.some((s) => s.playerId === cara)).toBe(true); // the seat passed on
    const hanaRow = final.ruthless!.find((r) => r.playerId === hana)!;
    expect(hanaRow.disqualified).toBe(true);
    expect(hanaRow.marks).toBeGreaterThanOrEqual(5);
  });

  it('a vote for a disqualified (but not yet escaped) player is accepted — the bump is a surprise at the reveal, not a refusal at the ballot', async () => {
    const snap = seenBy(backend, 'hana', gameId);
    const [cara, dev] = ['Cara', 'Dev'].map((n) => idOf(snap, n));

    const doc = JSON.parse(localStorage.getItem(`survival:game:${gameId}`)!);
    doc.answers = doc.answers.filter((a: { playerId: string }) => a.playerId !== dev);
    for (const q of [0, 1, 2, 3, 4]) {
      doc.answers.push({ playerId: dev, questionIdx: q, optionIndex: DARK_CHOICES[q][0], autoAssigned: false });
    }
    localStorage.setItem(`survival:game:${gameId}`, JSON.stringify(doc));

    tab('hana');
    await backend.advance(gameId); // → tribunal

    // Dev is disqualified already, but nobody has any way to know that yet —
    // ruthless is null until `result` (checked below) — so the room votes
    // for him anyway, and it must go through cleanly.
    tab('cara');
    await expect(backend.vote(gameId, dev)).resolves.toBeUndefined();
    expect(seenBy(backend, 'cara', gameId).ruthless).toBeNull();
    tab('hana');
    await backend.vote(gameId, dev);
    tab('dev');
    await backend.vote(gameId, cara);

    tab('hana');
    await backend.advance(gameId); // → result

    const final = seenBy(backend, 'cara', gameId);
    const devRow = final.ruthless!.find((r) => r.playerId === dev)!;
    expect(devRow.disqualified).toBe(true);
    // Dev had the most votes (2 vs Cara's 1) and still holds no seat.
    expect(final.seats!.some((s) => s.playerId === dev)).toBe(false);
    expect(final.seats!.some((s) => s.playerId === cara)).toBe(true);
  });

  it('never disqualifies a silent player, even though the auto-assigned move is sometimes dark', async () => {
    // Dev never answered a single real question all game (playOut only moves
    // Hana/Cara when `best` is given, and nobody was given here) — every one
    // of his answers is auto-assigned. Some of those auto-picks land on a
    // dark option (the worst move sometimes is one), and none should count.
    const snap = seenBy(backend, 'hana', gameId);
    const dev = idOf(snap, 'Dev');
    expect(snap.answers.filter((a) => a.playerId === dev && a.questionIdx >= 0).every((a) => a.autoAssigned)).toBe(true);

    tab('hana');
    await backend.advance(gameId); // → tribunal
    await backend.advance(gameId); // → result
    const ruthless = seenBy(backend, 'hana', gameId).ruthless!.find((r) => r.playerId === dev)!;
    expect(ruthless.marks).toBe(0);
    expect(ruthless.disqualified).toBe(false);
  });

  it('refuses a vote for someone already aboard', async () => {
    const real = docOf(gameId).keyCode;
    tab('cara');
    await backend.escape(gameId, real);
    tab('hana');
    await backend.advance(gameId); // → tribunal
    tab('dev');
    await expect(backend.vote(gameId, idOf(seenBy(backend, 'dev', gameId), 'Cara')))
      .rejects.toThrow(/already on the helicopter/i);
  });
});

/**
 * Walk from the first warm-up through to question 0, revealing each along the
 * way. Every test in the describe block above assumes it starts at question
 * 0, exactly as it did before warm-ups existed — this is what keeps that true.
 */
async function skipWarmups(backend: Backend, gameId: string) {
  for (let i = 0; i < INTRO_QUESTIONS.length; i += 1) {
    tab('hana');
    await backend.reveal(gameId);
    await backend.advance(gameId);
  }
}

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

describe('consensus mode', () => {
  it('draws teams of two, folding the odd one out into the last team', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    for (const name of ['cara', 'dev', 'lee', 'gia']) {
      tab(name);
      await backend.join(made.code, name[0].toUpperCase() + name.slice(1));
    }
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — teams are drawn here

    // Five players: a team of two and a team of three, never a lone straggler.
    const sizes = ['hana', 'cara', 'dev', 'lee', 'gia'].map(
      (who) => seenBy(backend, who, made.gameId).myTeam?.length,
    );
    expect([...sizes].sort()).toEqual([2, 2, 3, 3, 3]);
  });

  it('is null (no team) in solo mode, the default', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    await backend.advance(made.gameId); // briefing
    expect(seenBy(backend, 'hana', made.gameId).myTeam).toBeNull();
  });

  it("one teammate's tap locks the choice in for the whole team", async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — one team of two
    await backend.advance(made.gameId); // running — first warm-up
    await skipWarmups(backend, made.gameId);

    tab('cara');
    await backend.answer(made.gameId, 2);

    // Hana never tapped, but the team's choice is already hers too.
    const hana = seenBy(backend, 'hana', made.gameId);
    const hanaId = idOf(hana, 'Hana');
    expect(hana.answers.find((a) => a.playerId === hanaId && a.questionIdx === 0)?.optionIndex).toBe(2);
    // And a second tap for the same round — from either of them — is refused,
    // exactly like a solo player's second tap would be.
    await expect(backend.answer(made.gameId, 3)).rejects.toThrow();
    tab('cara');
    await expect(backend.answer(made.gameId, 3)).rejects.toThrow();
  });

  it('lets a late joiner (no team yet drawn) keep answering solo', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — teams drawn from {Hana, Cara}
    await backend.advance(made.gameId); // running
    await skipWarmups(backend, made.gameId);

    tab('lee');
    await backend.join(made.code, 'Lee');
    expect(seenBy(backend, 'lee', made.gameId).myTeam).toBeNull();

    // Lee has no team, but can still answer for herself alone.
    await backend.answer(made.gameId, 1);
    const lee = seenBy(backend, 'lee', made.gameId);
    const leeId = idOf(lee, 'Lee');
    expect(lee.answers.find((a) => a.playerId === leeId && a.questionIdx === 0)?.optionIndex).toBe(1);
    // It never touched Hana or Cara's team.
    const hana = seenBy(backend, 'hana', made.gameId);
    const hanaId = idOf(hana, 'Hana');
    expect(hana.answers.some((a) => a.playerId === hanaId && a.questionIdx === 0)).toBe(false);
  });

  it('setMode is host-only and lobby-only', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    await expect(backend.setMode(made.gameId, 'consensus')).rejects.toThrow();

    tab('hana');
    await backend.advance(made.gameId); // briefing — past the lobby now
    await expect(backend.setMode(made.gameId, 'consensus')).rejects.toThrow();
  });

  it("splits a clued round's digit between teammates — one seer, one 'ask them' instead", async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — one team of two
    await backend.advance(made.gameId); // running — first warm-up
    await skipWarmups(backend, made.gameId); // → question 0, a clued round (berth 2, red)

    const hana = seenBy(backend, 'hana', made.gameId);
    const cara = seenBy(backend, 'cara', made.gameId);
    // Exactly one of them sees the digit; the other is told who to ask.
    const sawDigit = [hana, cara].filter((s) => s.clue !== null);
    const wasToldToAsk = [hana, cara].filter((s) => s.clueSeer !== null);
    expect(sawDigit).toHaveLength(1);
    expect(wasToldToAsk).toHaveLength(1);
    expect(sawDigit[0].clue?.questionIdx).toBe(0);
    // Whoever wasn't the seer is told the OTHER one's name, not their own.
    expect(wasToldToAsk[0].clueSeer?.name).toBe(sawDigit[0] === hana ? 'Hana' : 'Cara');
  });

  it("shares one keypad cooldown across the team, even for a member who never guessed", async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running
    await skipWarmups(backend, made.gameId);

    tab('hana');
    const wrong = await backend.escape(made.gameId, '0000');
    expect(wrong.accepted).toBe(false);

    // Cara never touched the keypad, but her cooldown is already running.
    const cara = seenBy(backend, 'cara', made.gameId);
    expect(cara.retryInSeconds).toBeGreaterThan(0);
    await expect(backend.escape(made.gameId, '1111')).rejects.toThrow();
  });

  it('cracking the code seats the WHOLE team at once, not just whoever typed it', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running
    await skipWarmups(backend, made.gameId);

    tab('hana');
    await backend.escape(made.gameId, '0000'); // burn the shared cooldown
    clearCooldown(made.gameId, idOf(seenBy(backend, 'hana', made.gameId), 'Hana'));

    const code = docOf(made.gameId).keyCode;
    tab('cara'); // Cara solves it — Hana never touches the keypad again.
    const solved = await backend.escape(made.gameId, code);
    expect(solved.accepted).toBe(true);

    const snap = seenBy(backend, 'hana', made.gameId);
    const hanaId = idOf(snap, 'Hana');
    const caraId = idOf(snap, 'Cara');
    expect(snap.escapedPlayerIds).toEqual(expect.arrayContaining([hanaId, caraId]));
  });

  it('a team bigger than the seats left over shares the last one, contested — never an arbitrary pick', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    const names = ['hana', 'cara', 'dev', 'lee', 'gia'];
    tab('hana');
    const made = await backend.create('Hana');
    for (const name of names.slice(1)) {
      tab(name);
      await backend.join(made.code, name[0].toUpperCase() + name.slice(1));
    }
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — teams are drawn randomly here
    await backend.advance(made.gameId); // running — first warm-up

    // Teams are random now, so find out who actually ended up on the pair
    // vs the trio rather than assuming any particular name did.
    const pairMember = names.find((n) => (seenBy(backend, n, made.gameId).myTeam?.length ?? 0) === 2)!;
    const trioMember = names.find((n) => (seenBy(backend, n, made.gameId).myTeam?.length ?? 0) === 3)!;
    const pairIds = seenBy(backend, pairMember, made.gameId).myTeam!;
    const trioIds = seenBy(backend, trioMember, made.gameId).myTeam!;

    const code = docOf(made.gameId).keyCode;
    // The pair solves first and takes 2 of the 3 seats.
    tab(pairMember);
    const first = await backend.escape(made.gameId, code);
    expect(first.accepted).toBe(true);

    // The trio solves next — only 1 seat is left for the 3 of them.
    tab(trioMember);
    const second = await backend.escape(made.gameId, code);
    expect(second.accepted).toBe(true);

    await skipWarmups(backend, made.gameId);
    tab('hana');
    await playOut(backend, made.gameId);
    await backend.advance(made.gameId); // → plea
    await backend.advance(made.gameId); // → tribunal
    await backend.advance(made.gameId); // → result

    const snap = seenBy(backend, 'hana', made.gameId);
    const trioSeats = (snap.seats ?? []).filter((s) => trioIds.includes(s.playerId));
    // All 3 share what's left, marked contested — never 1 or 2 of them
    // picked arbitrarily by insertion order.
    expect(trioSeats).toHaveLength(3);
    expect(trioSeats.every((s) => s.contested && s.path === 'escape' && s.seat === SEATS)).toBe(true);

    const pairSeats = (snap.seats ?? []).filter((s) => pairIds.includes(s.playerId));
    expect(pairSeats).toHaveLength(2);
    expect(pairSeats.every((s) => !s.contested)).toBe(true);
  });
});
