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
import { CHOICE_QUESTIONS, seatsFor, survivalOddsOf, survivalOddsPrecise } from '../types';
import { teamSizes } from '../scale';
import type {
  Answer,
  Game,
  MyScore,
  Player,
  Plea,
  RevealRow,
  Seat,
  SeatPath,
  Snapshot,
  Standing,
  Vote,
} from '../types';
import { EXTRACTION, INTRO_QUESTIONS, QUESTIONS, RUTHLESS_LIMIT, marksOf } from '../questions';
import {
  buildPuzzle, dealPuzzle, ruleText,
  type ManifestLine, type Rule,
} from '../puzzles';
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
  /**
   * One puzzle per green berth, built around that berth's digit when the key
   * is generated. The digit is the ANSWER — it is nowhere in here.
   */
  puzzles: { berth: number; lines: ManifestLine[]; answerLineId: number }[];
  /** Who holds which fragment, per berth. Private until its holder posts it. */
  fragments: { berth: number; playerId: string; rule: Rule }[];
  /** The ledger: fragments their holders chose to publish. */
  posts: { berth: number; playerId: string; at: number }[];
  /** Open asks. Cleared for a berth once its asker's team has solved it. */
  asks: { berth: number; playerId: string }[];
  /** Which teams have read a berth off the board, in the order they did. */
  solves: { berth: number; teamId: string; playerId: string; at: number }[];
}

/** The 7 of 9 real questions that carry a manifest line, in question order. */
const CLUED_QUESTIONS: number[] = QUESTIONS.reduce<number[]>(
  (acc, q, idx) => (q.manifest ? [...acc, idx] : acc),
  [],
);

/**
 * The green berths, in the order their rounds open them.
 *
 * A berth's puzzle unlocks when its round opens and stays open for the rest
 * of the night. The red decoy rounds carry no puzzle: they keep the
 * read-only manifest line they always had, because that is the attention
 * mechanic and it is woven into the scenario prose.
 */
const GREEN_BERTHS: { berth: number; questionIdx: number }[] = QUESTIONS.flatMap((q, idx) =>
  q.manifest?.color === 'green' ? [{ berth: q.manifest.berth, questionIdx: idx }] : [],
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
 * Build a puzzle per green berth and deal one fragment per player.
 *
 * Runs at the lobby→briefing transition, alongside the teams, for the same
 * reason they do: the roster is fixed by then, and re-dealing later would
 * change the board under a room that is already negotiating over it.
 *
 * The digit is already decided — `generateKey()` picked it when the game was
 * created — so nothing here touches the seal. It only decides how the room
 * gets to a number that already existed.
 */
function dealPuzzles(doc: Doc) {
  // In solo mode there are no teams to spread fragments across, so everybody
  // is their own team. The cross-team guarantee is simply unavailable there,
  // which is one more reason consensus is the mode worth running.
  const teams = doc.teams.length > 0
    ? doc.teams.map((t) => t.memberIds)
    : doc.players.map((p) => [p.id]);
  const roster = doc.players.map((p) => p.id);

  doc.puzzles = [];
  doc.fragments = [];
  for (const { berth, questionIdx } of GREEN_BERTHS) {
    const digit = doc.clueDigits[questionIdx];
    if (digit === undefined) continue;
    const seed = hashSeed(`${doc.game.id}:${berth}`);
    const puzzle = buildPuzzle(berth, digit, roster.length, seed);
    doc.puzzles.push({ berth, lines: puzzle.lines, answerLineId: puzzle.answerLineId });
    for (const fragment of dealPuzzle(puzzle, teams, seed)) {
      doc.fragments.push({ berth, playerId: fragment.playerId, rule: fragment.rule });
    }
  }
}

/**
 * A stable seed per game and berth.
 *
 * Stable so the board does not change when the backend recomputes it, and
 * per-berth so four puzzles in one night are four different puzzles.
 */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Which berths are open to the room — unlocked by their round, never re-closed. */
function unlockedBerths(doc: Doc): number[] {
  if (doc.game.phase === 'lobby' || doc.game.phase === 'briefing') return [];
  const reached = doc.game.phase === 'running' ? doc.game.questionIdx : QUESTIONS.length;
  return GREEN_BERTHS.filter((g) => g.questionIdx <= reached).map((g) => g.berth);
}

/** Has this player's team read this berth off the board yet? */
function berthSolvedByTeamOf(doc: Doc, berth: number, playerId: string | null): boolean {
  if (!playerId) return false;
  const team = teamOf(doc, playerId);
  return doc.solves.some((s) => s.berth === berth && team.memberIds.includes(s.playerId));
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
        mode: 'consensus',
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
      puzzles: [],
      fragments: [],
      posts: [],
      asks: [],
      solves: [],
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
      dealPuzzles(doc);
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

  /**
   * Publish your fragment for a berth.
   *
   * The one irreversible, purely generous act in the game: posting helps
   * whoever is racing you, and the board records that you did it. Which is
   * the point — a fragment you keep is a fragment that helps nobody, so the
   * room only assembles a berth if enough people give something away.
   *
   * A tap, never a typed value. You cannot publish a rule you do not hold
   * and you cannot alter one: colleagues deceiving each other is the wrong
   * payload for this, and the manifest is a ledger, not a rumour.
   */
  async postFragment(gameId: string, berth: number) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (!unlockedBerths(doc).includes(berth)) throw new SurvivalError('That berth is not open yet.');
    if (!doc.fragments.some((f) => f.berth === berth && f.playerId === me)) {
      throw new SurvivalError('You hold nothing for that berth.');
    }
    if (doc.posts.some((p) => p.berth === berth && p.playerId === me)) return;
    doc.posts.push({ berth, playerId: me, at: Date.now() });
    // Posting answers your own ask, and anybody still asking now has one
    // more line to work with.
    doc.asks = doc.asks.filter((a) => !(a.berth === berth && a.playerId === me));
    writeDoc(doc);
    this.announce(gameId);
  }

  /**
   * Ask the room for help on a berth.
   *
   * Also a tap. The quiet third of any team cannot be made to say "does
   * anybody have berth four" out loud on a call with twenty people on it,
   * and if asking needs a voice then the fragments only ever move between
   * the people who already talk.
   */
  async askForBerth(gameId: string, berth: number) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    if (!unlockedBerths(doc).includes(berth)) throw new SurvivalError('That berth is not open yet.');
    if (!doc.asks.some((a) => a.berth === berth && a.playerId === me)) {
      doc.asks.push({ berth, playerId: me });
    }
    writeDoc(doc);
    this.announce(gameId);
  }

  /**
   * Name the line you think survives every published rule.
   *
   * Right, and your whole team can read the seal off it — the team solves
   * together even though only one of you will walk through the door. Wrong,
   * and nothing happens at all: there is no cost, no cooldown and no limit
   * here, because this is the part of the night that is supposed to reward
   * trying things, and the keypad downstairs already carries the stakes.
   */
  async solveBerth(gameId: string, berth: number, lineId: number) {
    const doc = this.mustRead(gameId);
    const me = this.me(gameId);
    if (!me) throw new SurvivalError('Not in this game.');
    const puzzle = doc.puzzles.find((p) => p.berth === berth);
    if (!puzzle) throw new SurvivalError('No such berth.');
    if (!unlockedBerths(doc).includes(berth)) throw new SurvivalError('That berth is not open yet.');
    if (berthSolvedByTeamOf(doc, berth, me)) return { correct: true };

    if (lineId !== puzzle.answerLineId) return { correct: false };

    doc.solves.push({ berth, teamId: teamOf(doc, me).id, playerId: me, at: Date.now() });
    const team = teamOf(doc, me);
    doc.asks = doc.asks.filter((a) => !(a.berth === berth && team.memberIds.includes(a.playerId)));
    writeDoc(doc);
    this.announce(gameId);
    return { correct: true };
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

    // Consensus mode shares the whole keypad with your team: one cooldown,
    // one attempt count, any teammate's wrong guess resetting it for all of
    // you. What it no longer shares is the seat — see below.
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
      // The seat belongs to whoever states the code, not to their whole
      // team — a reversal of how this worked when there were three seats and
      // teams were pairs.
      //
      // It has to be. The escape path is now one of three that share a
      // scaled seat count: at twelve players that is three seats, and a team
      // of four boarding together takes every one of them, which leaves the
      // nine moral rounds and the entire tribunal deciding nothing. The same
      // collision in reverse — budgeting escape a single seat — marked every
      // solving team `contested`, turning a rare "we could not split this
      // honestly" outcome into the normal case.
      //
      // So the team still solves it together: shared clue ownership, one
      // keypad, one cooldown, one attempt count, and the debrief credits
      // everyone who put a fragment in. Only the walk through the door is
      // individual, exactly as the pilot states it — anyone who can state
      // the code walks on now. Which member types it is the last thing a
      // team has to decide together, and it is a decision worth having.
      doc.escapes.push({ playerId: me, solveOrder: doc.escapes.length + 1, at: Date.now() });
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
 * Three ways onto the chopper, in the order they claim seats.
 *
 * The night used to have two, and one of them barely counted: escapees filled
 * seats in solve order, then the vote filled whatever was left. Survival odds
 * — the thing nine rounds of moral choices actually produce — entered the
 * arithmetic at exactly one place, as a tie-break between two players on
 * equal votes. So the nine questions decided nothing, and a room where three
 * people cracked the code skipped the tribunal entirely.
 *
 * Now each path claims its own share, so every phase of the night is load
 * bearing: the puzzles win `escape`, the nine questions win `record`, and the
 * plea wins `vote`.
 */
const SEAT_PATHS: SeatPath[] = ['escape', 'record', 'vote'];

/**
 * Who is still in the running on a given path, best first.
 *
 * An escapee is out of the running for the other two: they already have a
 * seat, and leaving them in `record` would have the best player take two.
 */
function queueFor(path: SeatPath, contenders: Contender[], taken: Set<string>): Contender[] {
  const open = contenders.filter((c) => !c.disqualified && !taken.has(c.playerId));
  if (path === 'escape') {
    return open
      .filter((c) => c.solveOrder !== null)
      .sort((a, b) => (a.solveOrder as number) - (b.solveOrder as number) || a.name.localeCompare(b.name));
  }
  // Not filtered on `solveOrder` — `taken` already holds anybody who has a
  // seat, and somebody whose team solved it but who did not type the code is
  // still in the running here.
  const unescaped = open;
  if (path === 'record') {
    // The unrounded figure, never the displayed one: two players can share a
    // rounded "64.0%" without being tied, and a seat decided on that would
    // call a real difference a draw.
    return unescaped.sort((a, b) => b.precise - a.precise || a.name.localeCompare(b.name));
  }
  return unescaped.sort(
    (a, b) => b.votes - a.votes || b.precise - a.precise || a.name.localeCompare(b.name),
  );
}

/**
 * The head of the queue plus everybody genuinely level with them.
 *
 * Each path ties on its own terms — a whole team shares one `solveOrder`, a
 * record ties on the precise odds, a vote ties on the count and then on the
 * odds behind it.
 */
function tiedAtHead(path: SeatPath, queue: Contender[]): Contender[] {
  const head = queue[0];
  if (path === 'escape') return queue.filter((c) => c.solveOrder === head.solveOrder);
  if (path === 'record') return queue.filter((c) => c.precise === head.precise);
  return queue.filter((c) => c.votes === head.votes && c.precise === head.precise);
}

/**
 * Seats, computed once from the frozen state at `result`.
 *
 * Each path gets a budget — `teamSizes` splits the seats three ways, giving
 * the remainder to the earlier paths — and then a second pass hands whatever
 * a path could not fill to the others, so a room where nobody cracked the
 * code does not fly out with empty seats for a boring reason. That
 * redistribution is itself the story: "nobody solved it, so the room chose
 * all five" is a result worth reading out.
 *
 * A group too big for the seats its path has left shares the last of them and
 * is marked `contested` — but only that path stops. It used to end the whole
 * allocation, which under three paths would let one large escaping team block
 * the other two entirely.
 */
function computeSeats(contenders: Contender[], seatCount: number): Seat[] {
  const seats: Seat[] = [];
  const taken = new Set<string>();
  let seatNo = 0;

  const claim = (path: SeatPath, budget: number) => {
    let spent = 0;
    while (spent < budget && seatNo < seatCount) {
      const queue = queueFor(path, contenders, taken);
      if (queue.length === 0) return;
      const group = tiedAtHead(path, queue);
      const room = Math.min(budget - spent, seatCount - seatNo);
      const contested = group.length > room;

      if (contested) seatNo += room;
      for (const c of group) {
        if (!contested) seatNo += 1;
        taken.add(c.playerId);
        seats.push({
          playerId: c.playerId,
          name: c.name,
          seat: seatNo,
          path,
          votes: c.votes,
          average: c.average,
          solveOrder: path === 'escape' ? c.solveOrder : null,
          contested,
        });
      }
      if (contested) return;
      spent += group.length;
    }
  };

  const budgets = teamSizes(seatCount, SEAT_PATHS.length);
  SEAT_PATHS.forEach((path, i) => claim(path, budgets[i] ?? 0));
  for (const path of SEAT_PATHS) claim(path, seatCount - seatNo);

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

  const seatCount = seatsFor(doc.players.length);
  const seats = game.phase === 'result' ? computeSeats(contenders, seatCount) : null;

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

  /**
   * The berth puzzles, cut to what this viewer may see.
   *
   * `lines` and `posted` are public: the manifest is a published ledger and
   * a posted fragment is one somebody chose to publish. `myRule` is yours
   * alone until you post it — that asymmetry IS the mechanic, and it is
   * applied here rather than in the view for the same reason every other
   * cut in this function is.
   *
   * `digit` is per TEAM, not per room: your team read it off the board, so
   * your team has it. Another team that has not done the deduction still
   * has to do the deduction.
   */
  const open = unlockedBerths(doc);
  const puzzles: Snapshot['puzzles'] = doc.puzzles
    .filter((p) => open.includes(p.berth))
    .sort((a, b) => a.berth - b.berth)
    .map((p) => {
      const mine = me ? doc.fragments.find((f) => f.berth === p.berth && f.playerId === me) : undefined;
      const posted = doc.posts
        .filter((post) => post.berth === p.berth)
        .sort((a, b) => a.at - b.at)
        .map((post) => ({
          playerId: post.playerId,
          text: ruleText(
            (doc.fragments.find((f) => f.berth === p.berth && f.playerId === post.playerId) as
              { rule: Rule }).rule,
          ),
        }));
      const firstSolve = doc.solves
        .filter((sv) => sv.berth === p.berth)
        .sort((a, b) => a.at - b.at)[0];
      return {
        berth: p.berth,
        lines: p.lines,
        myRule: mine ? ruleText(mine.rule) : null,
        myRulePosted: me ? doc.posts.some((post) => post.berth === p.berth && post.playerId === me) : false,
        posted,
        askingPlayerIds: doc.asks.filter((a) => a.berth === p.berth).map((a) => a.playerId),
        digit: berthSolvedByTeamOf(doc, p.berth, me)
          ? p.lines.find((l) => l.id === p.answerLineId)?.seal ?? null
          : null,
        firstSolvedBy: firstSolve
          ? doc.players.find((pl) => pl.id === firstSolve.playerId)?.name ?? null
          : null,
      };
    });

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
    seatCount,
    puzzles,
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
