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
const { DARK_CHOICES, INTRO_QUESTIONS, QUESTIONS } = await import('../questions');
import { seatsFor } from '../types';
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
    // Every test in this suite is about individual answers, individual
    // percentages and individual seats — consensus became the default mode
    // once teams started mattering, so this has to ask for solo explicitly
    // rather than lean on what a new game used to default to.
    await backend.setMode(gameId, 'solo');
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
    // Three players play for one seat, and nobody cracked the code, so the
    // record path claims it: everyone is level on votes, and Cara took the
    // best move every round. The tie is broken by the night she had, which
    // is the entire point of scoring nine rounds.
    expect(done.seatCount).toBe(seatsFor(3));
    expect(done.seats).toHaveLength(1);
    expect(done.seats![0].playerId).toBe(cara);
    expect(done.seats![0].path).toBe('record');
    expect(done.seats![0].seat).toBe(1);
    expect([hana, dev]).not.toContain(done.seats![0].playerId);
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
    // Explicit: two players default into one shared team, and a team's tap
    // fans out to everyone on it — which would turn "one answer" into two.
    await backend.setMode(made.gameId, 'solo');
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
    await backend.setMode(made.gameId, 'solo');
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
    await backend.setMode(made.gameId, 'solo');
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
    // Explicit: this whole suite is about individual attempts, individual
    // cooldowns and individual solve order, and three players default into
    // one shared team where all of that becomes team-wide instead.
    await backend.setMode(gameId, 'solo');
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

  it('gives the code its seat in solve order, and no more than its share', async () => {
    const real = docOf(gameId).keyCode;
    const first = ['cara', 'dev', 'hana'];
    for (const who of first) {
      tab(who);
      await backend.escape(gameId, real);
    }
    tab('hana');
    await backend.advance(gameId); // → tribunal
    await backend.advance(gameId); // → result

    const snap = seenBy(backend, 'hana', gameId);
    const seats = snap.seats!;
    // Everybody solved it, but the code is one path of three and this room
    // plays for one seat. It goes to whoever got there first, and the rest
    // of the chopper is not the code's to give away.
    expect(seats).toHaveLength(snap.seatCount);
    expect(seats[0].path).toBe('escape');
    expect(seats[0].playerId).toBe(idOf(snap, 'Cara'));
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

  it('never disqualifies anyone once the host has switched the ruthless cutoff off', async () => {
    // The toggle is lobby-only, so it must be set before this describe
    // block's beforeEach ever advances past the lobby — undo that here by
    // rebuilding the game fresh rather than mutating the shared fixture.
    installBrowser();
    const fresh = new LocalSurvivalBackend();
    tab('hana');
    const made = await fresh.create('Hana');
    tab('cara');
    await fresh.join(made.code, 'Cara');
    tab('hana');
    await fresh.setMode(made.gameId, 'solo');
    await fresh.setRuthlessEnabled(made.gameId, false);
    await fresh.advance(made.gameId); // briefing
    await fresh.advance(made.gameId); // running — first warm-up
    await skipWarmups(fresh, made.gameId);

    const snap = seenBy(fresh, 'hana', made.gameId);
    const hana = idOf(snap, 'Hana');
    const doc = JSON.parse(localStorage.getItem(`survival:game:${made.gameId}`)!);
    doc.answers = doc.answers.filter((a: { playerId: string }) => a.playerId !== hana);
    for (const q of [0, 1, 2, 3, 4]) {
      doc.answers.push({ playerId: hana, questionIdx: q, optionIndex: DARK_CHOICES[q][0], autoAssigned: false });
    }
    localStorage.setItem(`survival:game:${made.gameId}`, JSON.stringify(doc));

    tab('hana');
    await playOut(fresh, made.gameId);
    await fresh.advance(made.gameId); // → plea
    await fresh.advance(made.gameId); // → tribunal
    await fresh.advance(made.gameId); // → result

    const final = seenBy(fresh, 'hana', made.gameId);
    const hanaRow = final.ruthless!.find((r) => r.playerId === hana)!;
    // Five dark marks — the same tally that disqualifies elsewhere in this
    // file — but the cutoff itself is off, so the count still shows and the
    // seat is not refused for it.
    expect(hanaRow.marks).toBeGreaterThanOrEqual(5);
    expect(hanaRow.disqualified).toBe(false);
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

describe("a green berth's digit — never through the old clue path", () => {
  // The bug this guards against: survival_clue_digits (and its local twin
  // here) used to hand a clued round's digit straight to whoever the seer
  // was, or to everyone in solo mode, with no distinction between a red
  // decoy (attention only) and a green berth (the actual answer the whole
  // fragment/Exchange system exists to protect). A green round's digit must
  // never appear in `snapshot.clue`, current round or not, solo or
  // consensus — the Exchange is the only legitimate way to learn it now.
  const firstGreenIdx = QUESTIONS.findIndex((q) => q.manifest?.color === 'green');
  const firstRedIdx = QUESTIONS.findIndex((q) => q.manifest && q.manifest.color !== 'green');

  async function playTo(backend: Backend, gameId: string, questionIdx: number) {
    tab('hana');
    await backend.advance(gameId); // briefing
    await backend.advance(gameId); // running — first warm-up
    for (let i = 0; i < INTRO_QUESTIONS.length; i += 1) {
      await backend.reveal(gameId);
      await backend.advance(gameId);
    }
    for (let q = 0; q < questionIdx; q += 1) {
      await backend.reveal(gameId);
      await backend.advance(gameId);
    }
  }

  it('is null in solo mode, exactly when the old path would have shown it to everyone', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    await backend.setMode(made.gameId, 'solo');
    await playTo(backend, made.gameId, firstGreenIdx);

    const snap = seenBy(backend, 'hana', made.gameId);
    expect(snap.game.questionIdx).toBe(firstGreenIdx);
    expect(snap.clue).toBeNull();
    expect(snap.clueSeer).toBeNull();
  });

  it('is null for the team\'s seer in consensus mode, not just everyone else', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await playTo(backend, made.gameId, firstGreenIdx);

    for (const who of ['hana', 'cara']) {
      const snap = seenBy(backend, who, made.gameId);
      expect(snap.clue, `${who} (green round)`).toBeNull();
      // Not even redirected to "ask your teammate" — there is no seer for a
      // green round any more, because there is nothing left for a seer to
      // see through this path.
      expect(snap.clueSeer, `${who} (green round)`).toBeNull();
    }
  });

  it('still works normally for a red decoy round, in the same game', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    await backend.setMode(made.gameId, 'solo');
    await playTo(backend, made.gameId, firstRedIdx);

    const snap = seenBy(backend, 'hana', made.gameId);
    expect(snap.game.questionIdx).toBe(firstRedIdx);
    expect(snap.clue).not.toBeNull();
    expect(snap.clue?.questionIdx).toBe(firstRedIdx);
    expect(typeof snap.clue?.digit).toBe('number');
  });
});

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

  it('is null (no team) when a host switches a lobby to solo', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    await backend.setMode(made.gameId, 'solo');
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

  it("folds a late joiner into the smallest team, once one has been drawn", async () => {
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
    const lee = seenBy(backend, 'lee', made.gameId);
    const leeId = idOf(lee, 'Lee');

    // Not teamless: a late joiner used to play every puzzle as a team of
    // one, which is exactly the single point of failure noTeamSolves exists
    // to rule out. {Hana, Cara} was the only team, so Lee joins it.
    expect(lee.myTeam).not.toBeNull();
    expect(lee.myTeam).toContain(leeId);
    expect(lee.myTeam?.length).toBe(3);

    // And because she is now on their team, her tap locks the answer for
    // Hana and Cara too — the same fan-out any other teammate's tap has.
    await backend.answer(made.gameId, 1);
    const hana = seenBy(backend, 'hana', made.gameId);
    const hanaId = idOf(hana, 'Hana');
    expect(hana.answers.find((a) => a.playerId === hanaId && a.questionIdx === 0)?.optionIndex).toBe(1);
  });

  it('deals a late joiner a fragment for every berth already open', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    tab('cara');
    await backend.join(made.code, 'Cara');
    tab('hana');
    await backend.setMode(made.gameId, 'consensus');
    await backend.advance(made.gameId); // briefing — teams and puzzles are dealt here
    await backend.advance(made.gameId); // running
    await skipWarmups(backend, made.gameId);
    await backend.answer(made.gameId, 1);
    tab('hana');
    await backend.reveal(made.gameId);
    await backend.advance(made.gameId); // → question 1, berth 1 opens

    tab('lee');
    await backend.join(made.code, 'Lee');
    const lee = seenBy(backend, 'lee', made.gameId);
    const berth1 = lee.puzzles.find((p) => p.berth === 1);

    // She holds SOMETHING for the open berth — nobody arrives to an empty
    // hand — and it is never null the way a teamless late joiner's used to
    // read before this fix.
    expect(berth1?.myRule).not.toBeNull();

    // And it never solves the berth by itself: a spare rule is, by
    // construction, true of every line, so posting only Lee's fragment must
    // never narrow the board down to one.
    const lines = berth1?.lines ?? [];
    expect(lines.length).toBeGreaterThan(1);
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

  it('setRuthlessEnabled is host-only and lobby-only, and defaults to on', async () => {
    installBrowser();
    const backend = new LocalSurvivalBackend();
    tab('hana');
    const made = await backend.create('Hana');
    expect(seenBy(backend, 'hana', made.gameId).game.ruthlessEnabled).toBe(true);

    tab('cara');
    await backend.join(made.code, 'Cara');
    await expect(backend.setRuthlessEnabled(made.gameId, false)).rejects.toThrow();

    tab('hana');
    await backend.setRuthlessEnabled(made.gameId, false);
    expect(seenBy(backend, 'hana', made.gameId).game.ruthlessEnabled).toBe(false);

    await backend.advance(made.gameId); // briefing — past the lobby now
    await expect(backend.setRuthlessEnabled(made.gameId, true)).rejects.toThrow();
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

  it('seats whoever states the code, and leaves their team the other two paths', async () => {
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
    // The team solved it together — shared clues, one keypad, one cooldown,
    // and Hana's wrong guess is what set it running. But the walk through
    // the door is individual, because an escape path that seats whole teams
    // takes the entire chopper at any realistic headcount and leaves the
    // nine rounds and the tribunal deciding nothing.
    expect(snap.escapedPlayerIds).toEqual([caraId]);
    expect(snap.escapedPlayerIds).not.toContain(hanaId);
  });

  it('a solving team does not take the whole chopper with it', async () => {
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
    await backend.advance(made.gameId); // briefing — teams are drawn here
    await backend.advance(made.gameId); // running — first warm-up
    await skipWarmups(backend, made.gameId);

    // One member of one team states the code. Under the old rule their whole
    // team boarded, which at three seats meant a team of three took every
    // one of them and the other two paths decided nothing at all.
    const code = docOf(made.gameId).keyCode;
    const solver = names.find((n) => (seenBy(backend, n, made.gameId).myTeam?.length ?? 0) >= 2)!;
    tab(solver);
    expect((await backend.escape(made.gameId, code)).accepted).toBe(true);

    await playOut(backend, made.gameId);
    tab('hana');
    await backend.advance(made.gameId); // → plea
    await backend.advance(made.gameId); // → tribunal
    await backend.advance(made.gameId); // → result

    const snap = seenBy(backend, 'hana', made.gameId);
    const solverId = idOf(snap, solver[0].toUpperCase() + solver.slice(1));
    const escapeSeats = (snap.seats ?? []).filter((s) => s.path === 'escape');

    expect(snap.seatCount).toBe(seatsFor(5));
    expect(escapeSeats).toHaveLength(1);
    expect(escapeSeats[0].playerId).toBe(solverId);
    // Their teammates keep every other route out: the code took one seat,
    // not the aircraft.
    expect((snap.seats ?? []).length).toBeGreaterThan(1);
    expect((snap.seats ?? []).some((s) => s.path !== 'escape')).toBe(true);
  });

  it('gives the code, the record and the room a seat each', async () => {
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
    // Explicit: this proves each of the three paths seats a distinct
    // INDIVIDUAL, which a team's shared answers and shared escape would
    // blur — five players default into two teams, and a teammate would
    // otherwise share Cara's record or Dev's escape.
    await backend.setMode(made.gameId, 'solo');
    await backend.advance(made.gameId); // briefing
    await backend.advance(made.gameId); // running
    await skipWarmups(backend, made.gameId);

    // Dev cracks the code. Cara takes the best move every round and nobody
    // else answers at all, so Cara alone has a record worth a seat. The room
    // then votes Lee aboard.
    tab('dev');
    expect((await backend.escape(made.gameId, docOf(made.gameId).keyCode)).accepted).toBe(true);
    await playOut(backend, made.gameId, 'cara');

    tab('hana');
    await backend.advance(made.gameId); // → plea
    await backend.advance(made.gameId); // → tribunal

    const at = seenBy(backend, 'hana', made.gameId);
    const lee = idOf(at, 'Lee');
    for (const voter of ['hana', 'cara', 'gia']) {
      tab(voter);
      await backend.vote(made.gameId, lee);
    }
    tab('hana');
    await backend.advance(made.gameId); // → result

    const snap = seenBy(backend, 'hana', made.gameId);
    const seatOn = (path: string) => (snap.seats ?? []).filter((s) => s.path === path);

    // This is the whole point of the change. The puzzle, the nine moral
    // rounds and the plea each decide exactly one seat, so none of the three
    // is decoration.
    expect(snap.seatCount).toBe(3);
    expect(seatOn('escape').map((s) => s.name)).toEqual(['Dev']);
    expect(seatOn('record').map((s) => s.name)).toEqual(['Cara']);
    expect(seatOn('vote').map((s) => s.name)).toEqual(['Lee']);
  });

});
