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
import { CHOICE_QUESTIONS, survivalOddsOf, survivalOddsPrecise } from '../types';
import type {
  Answer,
  Game,
  MyScore,
  Player,
  Plea,
  RevealRow,
  Snapshot,
  Standing,
  Vote,
  Winner,
} from '../types';
import { INTRO_QUESTIONS, QUESTIONS } from '../questions';
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

    writeDoc({
      game: {
        id: gameId,
        code,
        hostUserId: 'local-host',
        phase: 'lobby',
        questionIdx: 0,
        revealed: false,
        createdAt: now,
      },
      players: [
        { id: playerId, gameId, userId: 'local-host', name: name.slice(0, 12), lastSeen: now },
      ],
      answers: [],
      scores: [],
      pleas: [],
      votes: [],
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

  async advance(gameId: string) {
    const doc = this.mustRead(gameId);
    if (!this.isHost(gameId)) throw new SurvivalError('Host only.', 'not_host');
    const game = doc.game;

    if (game.phase === 'lobby') game.phase = 'briefing';
    else if (game.phase === 'briefing') {
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
    assign(doc, me, doc.game.questionIdx, optionIndex, false);
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
    const existing = doc.votes.find((v) => v.voterId === me);
    if (existing) existing.targetPlayerId = targetPlayerId;
    else doc.votes.push({ voterId: me, targetPlayerId });
    writeDoc(doc);
    this.announce(gameId);
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

  // Ranked and tie-broken on the unrounded product — seven compounding rounds
  // routinely lands several players on the same rounded "0.0%", and deciding
  // either on that shared display value would call a real difference a tie.
  // `precise` never leaves this function; only the rounded `average` does.
  const withOdds = doc.players.map((player) => {
    const mine = doc.scores.filter((s) => s.playerId === player.id);
    return {
      playerId: player.id,
      name: player.name,
      rounds: mine.length,
      precise: survivalOddsPrecise(mine) ?? 0,
      average: survivalOddsOf(mine) ?? 0,
    };
  });

  let standings: Standing[] | null = null;
  if (ratesAreOpen(doc)) {
    standings = [...withOdds]
      .sort((a, b) => b.precise - a.precise || a.name.localeCompare(b.name))
      .map(({ playerId, name, rounds, average }) => ({ playerId, name, rounds, average }));
  }

  let winner: Winner[] | null = null;
  if (game.phase === 'result') {
    const tally = withOdds.map((s) => ({
      ...s,
      votes: doc.votes.filter((v) => v.targetPlayerId === s.playerId).length,
    }));
    const mostVotes = Math.max(0, ...tally.map((t) => t.votes));
    const contenders = tally.filter((t) => t.votes === mostVotes);
    const best = Math.max(...contenders.map((t) => t.precise));
    // Level on both and they share the seat, rather than a third rule nobody
    // agreed to.
    winner = contenders
      .filter((t) => t.precise === best)
      .map(({ playerId, name, votes, average }) => ({ playerId, name, votes, average }));
  }

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
    winner,
  };
}
