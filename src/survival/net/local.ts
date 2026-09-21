/**
 * Local backend — the whole game in one browser, shared across tabs.
 *
 * State lives in localStorage (shared by every tab on this origin); identity
 * lives in sessionStorage (per tab), which is what makes solo testing work:
 * open five tabs on the same room code and each one is a different person.
 *
 * IT CANNOT KEEP THE SEAL, and that is stated rather than worked around. Every
 * percentage it scores with is in the bundle, two clicks from devtools, because
 * there is no server here to hold anything back. It exists so the night can be
 * played through before it is deployed. Play it for real on Supabase.
 *
 * What it does enforce faithfully is everything else: a tap is final, silence
 * gets you the worst move, a late joiner is backfilled, and nobody's rate is
 * readable until the tribunal. Those rules being identical in both backends is
 * what makes testing here worth anything at all.
 */

import { SEALED, worstOption } from '../sealed';
import { CHOICE_QUESTIONS, SEATS, survivalOddsOf, survivalOddsPrecise } from '../types';
import type {
  Answer,
  Game,
  MyScore,
  Player,
  Plea,
  RevealRow,
  Seat,
  Snapshot,
  Standing,
  Vote,
} from '../types';
import { EXTRACTION, INTRO_QUESTIONS, QUESTIONS, RUTHLESS_LIMIT, marksOf } from '../questions';
import { SurvivalError, type SurvivalBackend } from './types';

interface Doc {
  game: Game;
  players: Player[];
  /** Every answer, unfiltered. `snapshot()` is what applies the visibility. */
  answers: Answer[];
  /** playerId → questionIdx → percentage. Filtered on the way out. */
  scores: { playerId: string; questionIdx: number; survivalPct: number }[];
  pleas: Plea[];
  votes: Vote[];
  /**
   * One random digit per round that carries a manifest line — this backend's
   * OWN independent generator (`Math.random`), not a mirror of anything in
   * `sealed.ts`. There is no static "correct answer" to keep in sync between
   * the two backends, unlike survival_pct: whichever backend runs a game
   * makes up its own extraction code for that game alone.
   */
  clueDigits: Record<number, number>;
  /** THE SEAL for this game. Never put into a Snapshot except via `keyReveal` at `result`. */
  keyCode: string;
  keyRecipe: string;
  /** Every attempt, right or wrong — mirrors `survival_attempts`. */
  attempts: { playerId: string; at: number; correct: boolean }[];
  /** The race. No `seat` here on purpose — seat allocation is policy (`computeSeats`), this is just fact. */
  escapes: { playerId: string; solveOrder: number; at: number }[];
  /**
   * Assigned once, from the lobby roster, the moment the briefing starts —
   * empty in solo mode, and empty in consensus mode until that transition
   * fires. Never touched again: reshuffling mid-game would strand whichever
   * teammate is mid-round.
   */
  teams: { id: string; memberIds: string[] }[];
  /**
   * Which teammate sees which clued round's digit — teamId → questionIdx →
   * playerId, drawn once alongside `teams`. Everyone else on that team gets
   * told WHO to ask, never the digit itself: the puzzle is supposed to need
   * a conversation, not just a shared keypad.
   */
  clueSeers: Record<string, Record<number, string>>;
}

/** The 7 of 9 real questions that carry a manifest line, in question order. */
const CLUED_QUESTIONS: number[] = QUESTIONS.reduce<number[]>(
  (acc, q, idx) => (q.manifest ? [...acc, idx] : acc),
  [],
);

/** Which question claims to be the green seal for a given berth. */
function berthQuestionIdx(berth: 1 | 2 | 3 | 4): number {
  return QUESTIONS.findIndex((q) => q.manifest?.color === 'green' && q.manifest.berth === berth);
}

/** This backend's own puzzle generator — random per game, never shared with sealed.ts. */
function generateKey(): { clueDigits: Record<number, number>; code: string; recipe: string } {
  const clueDigits: Record<number, number> = {};
  for (const idx of CLUED_QUESTIONS) clueDigits[idx] = Math.floor(Math.random() * 10);
  const code = ([4, 3, 2, 1] as const).map((berth) => clueDigits[berthQuestionIdx(berth)]).join('');
  return { clueDigits, code, recipe: `Berth 4 down to berth 1: ${code.split('').join(', ')}.` };
}

/**
 * An unbiased shuffle (Fisher–Yates), not `.sort(() => Math.random() - 0.5)`
 * — that trick is a well-known non-uniform shuffle, and "your teammate is
 * whoever happened to join near you" is exactly the kind of gameable
 * randomness a group would notice and resent.
 */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pairs, in random order, with the odd one out folded into the LAST team as
 * a trio rather than left standing alone — 5 players makes [2, 3], not
 * [2, 2, 1]. Randomised on purpose: who ends up with whom must never be
 * something a group of friends could arrange by controlling when they join.
 * A single leftover player (an N of 1) gets a team of one, which is a
 * degenerate but harmless case: `teamOf` below treats a teamless player
 * exactly the same way anyway.
 */
function chunkIntoTeams(playerIds: string[]): { id: string; memberIds: string[] }[] {
  const shuffledIds = shuffled(playerIds);
  const n = shuffledIds.length;
  if (n === 0) return [];
  const teamCount = Math.max(1, Math.floor(n / 2));
  return Array.from({ length: teamCount }, (_, t) => {
    const start = t * 2;
    const end = t === teamCount - 1 ? n : start + 2;
    return { id: `team-${t + 1}`, memberIds: shuffledIds.slice(start, end) };
  });
}

/**
 * A player's team, or a synthetic one-person team if they have none — a
 * teamless player (consensus mode, but joined after teams were drawn) simply
 * plays solo rather than being locked out of answering at all.
 */
function teamOf(doc: Doc, playerId: string): { id: string; memberIds: string[] } {
  return doc.teams.find((t) => t.memberIds.includes(playerId)) ?? { id: playerId, memberIds: [playerId] };
}

/** One random seer per team per clued round — drawn once, alongside the teams themselves. */
function assignClueSeers(teams: { id: string; memberIds: string[] }[]): Record<string, Record<number, string>> {
  const seers: Record<string, Record<number, string>> = {};
  for (const team of teams) {
    seers[team.id] = {};
    for (const idx of CLUED_QUESTIONS) {
      seers[team.id][idx] = team.memberIds[Math.floor(Math.random() * team.memberIds.length)];
    }
  }
  return seers;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const gameKey = (id: string) => `survival:game:${id}`;
const codeKey = (code: string) => `survival:code:${code.toUpperCase()}`;
const pidKey = (id: string) => `survival:pid:${id}`;
const hostKey = (id: string) => `survival:host:${id}`;

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function readDoc(gameId: string): Doc | null {
  try {
    const raw = localStorage.getItem(gameKey(gameId));
    return raw ? (JSON.parse(raw) as Doc) : null;
  } catch {
    return null;
  }
}

const writeDoc = (doc: Doc) =>
  localStorage.setItem(gameKey(doc.game.id), JSON.stringify(doc));

export class LocalSurvivalBackend implements SurvivalBackend {
  readonly kind = 'local' as const;

  private channel: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('survival') : null;

  async ready() {
    /* Nothing to reach. */
  }

  private announce(gameId: string) {
    this.channel?.postMessage({ type: 'changed', gameId });
    // A tab does not receive its own BroadcastChannel messages, and localStorage
    // events do not fire in the tab that wrote them either, so the writer has to
    // refresh itself.
    window.dispatchEvent(new CustomEvent('survival:changed', { detail: gameId }));
  }

  private mustRead(gameId: string): Doc {
    const doc = readDoc(gameId);
    if (!doc) throw new SurvivalError('That game has gone.', 'no_such_game');
    return doc;
  }

  private me(gameId: string): string | null {
    return sessionStorage.getItem(pidKey(gameId));
  }

  private isHost(gameId: string): boolean {
    return sessionStorage.getItem(hostKey(gameId)) === 'yes';
  }

  async create(name: string) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const gameId = uid();
    const playerId = uid();
    const now = new Date().toISOString();
    const key = generateKey();

    writeDoc({
      game: {
        id: gameId,
        code,
        hostUserId: 'local-host',
        phase: 'lobby',
        questionIdx: 0,
        revealed: false,
        createdAt: now,
        mode: 'solo',
      },
      players: [
        { id: playerId, gameId, userId: 'local-host', name: name.slice(0, 12), lastSeen: now },
      ],
      answers: [],
      scores: [],
      pleas: [],
      votes: [],
      clueDigits: key.clueDigits,
      keyCode: key.code,
      keyRecipe: key.recipe,
      attempts: [],
      escapes: [],
      teams: [],
      clueSeers: {},
    });
    localStorage.setItem(codeKey(code), gameId);
    sessionStorage.setItem(pidKey(gameId), playerId);
    sessionStorage.setItem(hostKey(gameId), 'yes');
    return { gameId, code, playerId };
  }

  async join(code: string, name: string) {
    const gameId = localStorage.getItem(codeKey(code.trim().toUpperCase()));
    if (!gameId) throw new SurvivalError('No game with that code.', 'no_such_game');
    const doc = this.mustRead(gameId);

    const existing = this.me(gameId);
    let playerId = existing && doc.players.some((p) => p.id === existing) ? existing : null;

    if (playerId) {
      const player = doc.players.find((p) => p.id === playerId);
      if (player) player.name = name.slice(0, 12) || player.name;
    } else {
      playerId = uid();
      doc.players.push({
        id: playerId,
        gameId,
        userId: playerId,
        name: name.slice(0, 12),
        lastSeen: new Date().toISOString(),
      });
      // Arriving late costs you every question the room has already been
      // through. Mirrors survival_join: no player ever has a gap.
      for (let q = 0; q < CHOICE_QUESTIONS; q += 1) {
        if (revealedAt(doc, q)) {
          const optionIndex = worstOption(q);
          assign(doc, playerId, q, optionIndex, true);
          doc.scores.push({ playerId, questionIdx: q, survivalPct: SEALED[q][optionIndex].survivalPct });
        }
      }
    }

    sessionStorage.setItem(pidKey(gameId), playerId);
    writeDoc(doc);
    this.announce(gameId);
    return { gameId, playerId };
  }

  async resume(gameId: string) {
    const doc = this.mustRead(gameId);
    const playerId = doc.players.some((p) => p.id === this.me(gameId)) ? this.me(gameId) : null;
    return { playerId, isHost: Boolean(playerId && this.isHost(gameId)) };
  }

  subscribe(gameId: string, onChange: (snapshot: Snapshot) => void) {
    const push = () => {
      const doc = readDoc(gameId);
      if (doc) onChange(snapshotFor(doc, this.me(gameId)));
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { gameId?: string })?.gameId === gameId) push();
    };
    this.channel?.addEventListener('message', onMessage);
    window.addEventListener('survival:changed', push);
    window.addEventListener('storage', push);
    push();
    return () => {
      this.channel?.removeEventListener('message', onMessage);
      window.removeEventListener('survival:changed', push);
      window.removeEventListener('storage', push);
    };
  }

  async reveal(gameId: string) {
    const doc = this.mustRead(gameId);
    if (!this.isHost(gameId)) throw new SurvivalError('Host only.', 'not_host');
    if (doc.game.phase !== 'running' || doc.game.revealed) return;

    const q = doc.game.questionIdx;
    // A warm-up has no worst move and no percentage — nothing was ever at
    // stake, so a silent player is simply never assigned an answer, and no
    // survival_scores-equivalent row is ever written. Mirrors the same guard
    // in supabase/migrations/20260914160000_survival_intro.sql exactly.
    if (q >= 0) {
      for (const player of doc.players) {
        assign(doc, player.id, q, worstOption(q), true);
      }
      // Percentages are written here and nowhere else, so nobody can learn what
      // their own tap was worth by watching their own row appear.
      for (const answer of doc.answers.filter((a) => a.questionIdx === q)) {
        if (doc.scores.some((s) => s.playerId === answer.playerId && s.questionIdx === q)) continue;
        doc.scores.push({
          playerId: answer.playerId,
          questionIdx: q,
          survivalPct: SEALED[q][answer.optionIndex].survivalPct,
        });
      }
    }
    doc.game.revealed = true;
    writeDoc(doc);
    this.announce(gameId);
  }

  async setMode(gameId: string, mode: 'solo' | 'consensus') {
    const doc = this.mustRead(gameId);
    if (!this.isHost(gameId)) throw new SurvivalError('Host only.', 'not_host');
    if (doc.game.phase !== 'lobby') throw new SurvivalError('Too late to change the mode now.');
    doc.game.mode = mode;
    writeDoc(doc);
    this.announce(gameId);
  }

  async advance(gameId: string) {
    const doc = this.mustRead(gameId);
    if (!this.isHost(gameId)) throw new SurvivalError('Host only.', 'not_host');
    const game = doc.game;

    if (game.phase === 'lobby') {
      game.phase = 'briefing';
      if (game.mode === 'consensus') {
        doc.teams = chunkIntoTeams(doc.players.map((p) => p.id));
        doc.clueSeers = assignClueSeers(doc.teams);
      }
    } else if (game.phase === 'briefing') {
      game.phase = 'running';
      // Starts on the first warm-up (a negative index), not question 0 — see
      // questionAt() in questions.ts for how that sign is resolved back into
      // an actual question.
      game.questionIdx = -INTRO_QUESTIONS.length;
      game.revealed = false;
    } else if (game.phase === 'running') {
      if (!game.revealed) throw new SurvivalError('Reveal this one first.');
      if (game.questionIdx < CHOICE_QUESTIONS - 1) {
        game.questionIdx += 1;
        game.revealed = false;
      } else game.phase = 'plea';
    } else if (game.phase === 'plea') game.phase = 'tribunal';
    else if (game.phase === 'tribunal') game.phase = 'result';

    writeDoc(doc);
    this.announce(gameId);
  }

  async answer(gameId: string, optionIndex: number) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (doc.game.phase !== 'running') throw new SurvivalError('Nothing to answer right now.');
    if (doc.game.revealed) throw new SurvivalError('That question is already open.');
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 4) throw new SurvivalError('Not one of the five moves.');
    if (doc.answers.some((a) => a.playerId === me && a.questionIdx === doc.game.questionIdx)) {
      throw new SurvivalError('You have already chosen.', 'already_chosen');
    }
    // In consensus mode this fans out to every teammate at once — the check
    // just above already covers "has this team gone already", because every
    // member gets a row the moment any one of them taps.
    for (const playerId of teamOf(doc, me).memberIds) {
      assign(doc, playerId, doc.game.questionIdx, optionIndex, false);
    }
    writeDoc(doc);
    this.announce(gameId);
  }

  async plea(gameId: string, text: string) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (doc.game.phase !== 'plea') throw new SurvivalError('The chopper is not listening.');
    const trimmed = text.trim().slice(0, 150);
    const existing = doc.pleas.find((p) => p.playerId === me);
    if (existing) existing.text = trimmed;
    else doc.pleas.push({ playerId: me, text: trimmed });
    writeDoc(doc);
    this.announce(gameId);
  }

  async vote(gameId: string, targetPlayerId: string) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (doc.game.phase !== 'tribunal') throw new SurvivalError('Voting is closed.');
    if (targetPlayerId === me) throw new SurvivalError('You cannot vote for yourself.');
    if (!doc.players.some((p) => p.id === targetPlayerId)) {
      throw new SurvivalError('That person is not in this game.');
    }
    if (doc.escapes.some((e) => e.playerId === targetPlayerId)) {
      throw new SurvivalError('They are already on the helicopter.');
    }
    // Deliberately NOT refusing a vote for a disqualified player: that would
    // tell the room who is secretly disqualified mid-vote, which is exactly
    // the surprise "bumped at the reveal" moment this mechanic exists for.
    // computeSeats() is where a disqualified vote-winner is actually skipped.
    const existing = doc.votes.find((v) => v.voterId === me);
    if (existing) existing.targetPlayerId = targetPlayerId;
    else doc.votes.push({ voterId: me, targetPlayerId });
    writeDoc(doc);
    this.announce(gameId);
  }

  async escape(gameId: string, code: string) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (!['running', 'plea', 'tribunal'].includes(doc.game.phase)) {
      throw new SurvivalError('The keypad is dark right now.');
    }
    if (doc.escapes.some((e) => e.playerId === me)) {
      throw new SurvivalError('You are already aboard.', 'already_escaped');
    }

    // Consensus mode shares the whole keypad with your team: the same
    // cooldown (any teammate's wrong guess starts it for all of you), and —
    // if the code is right — the same seats, all at once.
    const team = teamOf(doc, me);
    const teamAttempts = doc.attempts.filter((a) => team.memberIds.includes(a.playerId));
    const last = teamAttempts.reduce<number | null>((latest, a) => (latest === null || a.at > latest ? a.at : latest), null);
    const waited = last === null ? Infinity : (Date.now() - last) / 1000;
    if (waited < EXTRACTION.retrySeconds) {
      // The client should already be disabling the button for this window;
      // this refusal is belt-and-suspenders and records nothing new.
      throw new SurvivalError('The keypad is still resetting.');
    }

    const normalized = code.replace(/[^0-9]/g, '').slice(0, EXTRACTION.length);
    const correct = normalized.length === EXTRACTION.length && normalized === doc.keyCode;
    doc.attempts.push({ playerId: me, at: Date.now(), correct });
    if (correct) {
      // One shared batch number for the whole team, not one row each with
      // its own — computeSeats() groups escapees by this number precisely so
      // a team that solves it together either all get a seat or all share
      // the last one, never an arbitrary subset picked by insertion order.
      const batchOrder = 1 + new Set(doc.escapes.map((e) => e.solveOrder)).size;
      const now = Date.now();
      for (const playerId of team.memberIds) {
        if (doc.escapes.some((e) => e.playerId === playerId)) continue;
        doc.escapes.push({ playerId, solveOrder: batchOrder, at: now });
      }
    }
    writeDoc(doc);
    this.announce(gameId);
    return { accepted: correct, retryInSeconds: correct ? 0 : EXTRACTION.retrySeconds };
  }

  heartbeat(gameId: string) {
    const doc = readDoc(gameId);
    const me = this.me(gameId);
    if (!doc || !me) return;
    const player = doc.players.find((p) => p.id === me);
    if (!player) return;
    player.lastSeen = new Date().toISOString();
    writeDoc(doc);
  }
}

// ── the rules, shared by every path above ──────────────────────────────────

/** A tap is final: an existing answer is never overwritten. */
function assign(doc: Doc, playerId: string, questionIdx: number, optionIndex: number, auto: boolean) {
  if (doc.answers.some((a) => a.playerId === playerId && a.questionIdx === questionIdx)) return;
  doc.answers.push({ playerId, questionIdx, optionIndex, autoAssigned: auto });
}

const revealedAt = (doc: Doc, questionIdx: number): boolean =>
  ['plea', 'tribunal', 'result'].includes(doc.game.phase) ||
  doc.game.questionIdx > questionIdx ||
  (doc.game.questionIdx === questionIdx && doc.game.revealed);

const ratesAreOpen = (doc: Doc): boolean =>
  doc.game.phase === 'tribunal' || doc.game.phase === 'result';

interface Contender {
  playerId: string;
  name: string;
  votes: number;
  precise: number;
  average: number;
  solveOrder: number | null;
  marks: number;
  disqualified: boolean;
}

/**
 * Two parallel win paths, computed once from the frozen state at `result`.
 *
 * Path A (the race): clean escapees, in solve order, fill seats first — a
 * disqualified solver is skipped, not reserved; the seat passes to the next
 * solver. A team escapes as one batch sharing a single solve order (see
 * `escape()`), so Path A can tie too, not just Path B: a batch that fits
 * entirely gets consecutive seats, and a batch bigger than the room left
 * shares the last seat and is marked `contested` — the same handling Path B
 * already used for an unsplittable vote tie, just grouped on solve order
 * instead of on votes. Path B (the vote): whatever seats are left fill from
 * the vote tally among clean non-escapees, tied on the *unrounded* odds.
 */
function computeSeats(contenders: Contender[]): Seat[] {
  const clean = (c: Contender) => !c.disqualified;

  const escapedPool = contenders
    .filter((c) => c.solveOrder !== null && clean(c))
    .sort((a, b) => (a.solveOrder as number) - (b.solveOrder as number) || a.name.localeCompare(b.name));

  const seats: Seat[] = [];
  let escSeatNo = 0;
  let escIdx = 0;
  while (escIdx < escapedPool.length && escSeatNo < SEATS) {
    const head = escapedPool[escIdx];
    const batch = escapedPool.filter((c) => c.solveOrder === head.solveOrder);
    const contested = batch.length > SEATS - escSeatNo;
    for (const c of batch) {
      if (!contested) escSeatNo += 1;
      seats.push({
        playerId: c.playerId,
        name: c.name,
        seat: contested ? SEATS : escSeatNo,
        path: 'escape',
        votes: c.votes,
        average: c.average,
        solveOrder: c.solveOrder,
        contested,
      });
    }
    escIdx += batch.length;
    if (contested) break;
  }

  const pool = contenders
    .filter((c) => c.solveOrder === null && clean(c))
    .sort((a, b) => b.votes - a.votes || b.precise - a.precise || a.name.localeCompare(b.name));

  let seatNo = seats.length;
  let i = 0;
  while (i < pool.length && seatNo < SEATS) {
    const head = pool[i];
    const tiedGroup = pool.filter((c) => c.votes === head.votes && c.precise === head.precise);
    const contested = tiedGroup.length > SEATS - seatNo;
    for (const c of tiedGroup) {
      if (!contested) seatNo += 1;
      seats.push({
        playerId: c.playerId,
        name: c.name,
        seat: contested ? SEATS : seatNo,
        path: 'vote',
        votes: c.votes,
        average: c.average,
        solveOrder: null,
        contested,
      });
    }
    i += tiedGroup.length;
    if (contested) break;
  }

  return seats;
}

/**
 * Apply this viewer's visibility. The same cuts the Postgres policies make,
 * made here too — a local backend that showed more would give false confidence
 * in the one rule the game is built on.
 */
function snapshotFor(doc: Doc, me: string | null): Snapshot {
  const game = doc.game;

  const answers = doc.answers.filter(
    (a) => a.playerId === me || revealedAt(doc, a.questionIdx),
  );

  const myScores: MyScore[] = doc.scores
    .filter((s) => s.playerId === me)
    .map((s) => ({ questionIdx: s.questionIdx, survivalPct: s.survivalPct }))
    .sort((a, b) => a.questionIdx - b.questionIdx);

  const pleas = doc.pleas.filter((p) => p.playerId === me || ratesAreOpen(doc));
  const votes = doc.votes.filter((v) => v.voterId === me || game.phase === 'result');

  // Read from the unfiltered doc on purpose: who has acted is public even
  // while what they did is not.
  const answeredPlayerIds = doc.answers
    .filter((a) => a.questionIdx === game.questionIdx)
    .map((a) => a.playerId);
  const pleadedPlayerIds = doc.pleas.map((p) => p.playerId);
  const votedPlayerIds = doc.votes.map((v) => v.voterId);

  // A warm-up has no SEALED entry — nothing to build a reveal row from here.
  // Player.tsx already knows to render a warm-up's outcomes straight from the
  // public `question.outcomes` instead, the same way the Supabase backend's
  // `survival_reveal_data` naturally returns nothing for a negative index
  // (there is no `survival_options` row to find).
  let reveal: RevealRow[] | null = null;
  if (game.phase === 'running' && game.revealed && game.questionIdx >= 0) {
    reveal = SEALED[game.questionIdx].map((move, optionIndex) => ({
      optionIndex,
      label: QUESTIONS[game.questionIdx].choices[optionIndex],
      outcome: move.outcome,
      takers: doc.answers.filter(
        (a) => a.questionIdx === game.questionIdx && a.optionIndex === optionIndex,
      ).length,
    }));
  }

  // Ranked and tie-broken on the unrounded geometric mean — two players can
  // still land on the same rounded display by coincidence, and deciding
  // either on that shared display value would call a real difference a tie.
  // `precise` never leaves this function; only the rounded `average` does.
  const contenders: Contender[] = doc.players.map((player) => {
    const mine = doc.scores.filter((s) => s.playerId === player.id);
    const marks = marksOf(doc.answers, player.id);
    const escape = doc.escapes.find((e) => e.playerId === player.id);
    return {
      playerId: player.id,
      name: player.name,
      votes: doc.votes.filter((v) => v.targetPlayerId === player.id).length,
      precise: survivalOddsPrecise(mine) ?? 0,
      average: survivalOddsOf(mine) ?? 0,
      solveOrder: escape ? escape.solveOrder : null,
      marks,
      disqualified: marks >= RUTHLESS_LIMIT,
    };
  });

  let standings: Standing[] | null = null;
  if (ratesAreOpen(doc)) {
    standings = [...contenders]
      .sort((a, b) => b.precise - a.precise || a.name.localeCompare(b.name))
      .map(({ playerId, name, average }) => ({
        playerId,
        name,
        rounds: doc.scores.filter((s) => s.playerId === playerId).length,
        average,
      }));
  }

  // Result only, deliberately — NOT tribunal. Exposing this while the vote is
  // still open would let the room strategically avoid a disqualified
  // candidate instead of discovering the bump as a surprise at the reveal.
  const ruthless =
    game.phase === 'result'
      ? contenders.map(({ playerId, name, marks, disqualified }) => ({ playerId, name, marks, disqualified }))
      : null;

  const seats = game.phase === 'result' ? computeSeats(contenders) : null;

  const escapedPlayerIds = [...doc.escapes]
    .sort((a, b) => a.solveOrder - b.solveOrder)
    .map((e) => e.playerId);

  // In consensus mode, a clued round's digit goes to one randomly-assigned
  // seer per team — everyone else on that team gets told who to ask instead
  // of the number itself. Solo mode, and a teamless player, see it exactly
  // like before: unconditionally, the moment the round is current.
  const rawDigit = game.phase === 'running' && game.questionIdx in doc.clueDigits
    ? doc.clueDigits[game.questionIdx]
    : null;
  let clue: Snapshot['clue'] = null;
  let clueSeer: Snapshot['clueSeer'] = null;
  if (rawDigit !== null) {
    const myTeamRow = me ? doc.teams.find((t) => t.memberIds.includes(me)) : undefined;
    const seerId = game.mode === 'consensus' && myTeamRow ? doc.clueSeers[myTeamRow.id]?.[game.questionIdx] : undefined;
    if (!seerId || seerId === me) {
      clue = { questionIdx: game.questionIdx, digit: rawDigit };
    } else {
      const seerName = doc.players.find((p) => p.id === seerId)?.name;
      if (seerName) clueSeer = { name: seerName };
    }
  }

  // Shared across the whole team in consensus mode — any teammate's wrong
  // guess starts everyone's cooldown, the same way one shared keypad would.
  const team = me ? teamOf(doc, me) : null;
  const teamAttemptRows = team ? doc.attempts.filter((a) => team.memberIds.includes(a.playerId)) : [];
  const lastAttempt = teamAttemptRows.reduce<number | null>(
    (latest, a) => (latest === null || a.at > latest ? a.at : latest),
    null,
  );
  const retryInSeconds =
    lastAttempt === null
      ? 0
      : Math.max(0, Math.ceil(EXTRACTION.retrySeconds - (Date.now() - lastAttempt) / 1000));
  const teamAttempts = teamAttemptRows.filter((a) => !a.correct).length;

  const keyReveal = game.phase === 'result' ? { code: doc.keyCode, recipe: doc.keyRecipe } : null;

  const myTeam = me && game.mode === 'consensus'
    ? (doc.teams.find((t) => t.memberIds.includes(me))?.memberIds ?? null)
    : null;

  return {
    game,
    players: doc.players,
    answers,
    myScores,
    pleas,
    votes: votes as Vote[],
    answeredPlayerIds,
    pleadedPlayerIds,
    votedPlayerIds,
    reveal,
    standings,
    seats,
    clue,
    clueSeer,
    escapedPlayerIds,
    retryInSeconds,
    teamAttempts,
    ruthless,
    keyReveal,
    myTeam,
  };
}
