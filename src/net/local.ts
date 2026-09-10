/**
 * Local backend — the whole game in the browser, shared across tabs.
 *
 * State lives in localStorage (shared by every tab on this origin); identity
 * lives in sessionStorage (per tab), which is what makes solo multiplayer
 * testing possible: open the Stage in one tab and three players in three more,
 * and each tab is a different person.
 *
 * It deliberately enforces the SAME sealing rules as the Postgres policies —
 * a submission is invisible to other players until `revealing`, a vote until
 * `scored`. If this backend were more permissive, testing against it would give
 * false confidence in the mechanic that matters most.
 */

import {
  scoreAllplay,
  scoreDuel,
  scoreGuessWho,
  scoreSolo,
} from '../game/scoring';
import { visibleSubmissions, visibleVotes } from '../game/sealing';
import type {
  CharacterLook,
  Game,
  Heat,
  Player,
  Round,
  RoundPhase,
  Submission,
  Vote,
} from '../game/types';
import {
  BackendError,
  type Backend,
  type GameSnapshot,
  type Reaction,
  type StartRoundOptions,
  type VoteInput,
} from './types';

interface GameDoc {
  game: Game;
  players: Player[];
  rounds: Round[];
  submissions: Submission[];
  votes: Vote[];
  /** playerId → epoch ms of last heartbeat. */
  seen: Record<string, number>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PRESENCE_TIMEOUT_MS = 25_000;

const gameKey = (id: string) => `campfire:game:${id}`;
const codeKey = (code: string) => `campfire:code:${code.toUpperCase()}`;
const pidKey = (id: string) => `campfire:pid:${id}`;
const hostKey = (id: string) => `campfire:host:${id}`;

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function readDoc(gameId: string): GameDoc | null {
  try {
    const raw = localStorage.getItem(gameKey(gameId));
    return raw ? (JSON.parse(raw) as GameDoc) : null;
  } catch {
    return null;
  }
}

function writeDoc(doc: GameDoc) {
  localStorage.setItem(gameKey(doc.game.id), JSON.stringify(doc));
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;

  private channel: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('campfire') : null;

  private reactionHandlers = new Set<(r: Reaction) => void>();

  constructor() {
    this.channel?.addEventListener('message', (event) => {
      const msg = event.data as { type: string; gameId?: string; reaction?: Reaction };
      if (msg.type === 'reaction' && msg.reaction) {
        for (const h of this.reactionHandlers) h(msg.reaction);
      }
    });
  }

  async ready() {
    /* Always available. */
  }

  // ── identity ─────────────────────────────────────────────────────────────

  private myId(gameId: string): string | null {
    return sessionStorage.getItem(pidKey(gameId));
  }

  private setMyId(gameId: string, playerId: string, isHost: boolean) {
    sessionStorage.setItem(pidKey(gameId), playerId);
    if (isHost) sessionStorage.setItem(hostKey(gameId), '1');
  }

  private amHost(gameId: string): boolean {
    return sessionStorage.getItem(hostKey(gameId)) === '1';
  }

  private requireHost(gameId: string) {
    if (!this.amHost(gameId)) {
      throw new BackendError('Only the host can do that.', 'not_host');
    }
  }

  private mutate(gameId: string, fn: (doc: GameDoc) => void) {
    const doc = readDoc(gameId);
    if (!doc) throw new BackendError('That game no longer exists.', 'no_such_game');
    fn(doc);
    writeDoc(doc);
    this.notify(gameId);
  }

  private notify(gameId: string) {
    this.channel?.postMessage({ type: 'change', gameId });
    // Same-tab listeners: BroadcastChannel does not echo to its own context.
    window.dispatchEvent(new CustomEvent('campfire:change', { detail: { gameId } }));
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async createGame(deckId: string, themeId: string, hostName: string, look: CharacterLook) {
    const gameId = uid();
    let code = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join('');
      if (!localStorage.getItem(codeKey(code))) break;
    }

    const hostId = uid();
    const now = new Date().toISOString();

    const doc: GameDoc = {
      game: {
        id: gameId,
        code,
        hostUserId: hostId,
        deckId,
        themeId,
        phase: 'lobby',
        roundNo: 0,
        heatCap: 1,
        createdAt: now,
      },
      players: [
        {
          id: hostId,
          gameId,
          userId: hostId,
          name: hostName.trim() || 'Host',
          look,
          isProxy: false,
          controlledBy: null,
          score: 0,
          passSpent: false,
          lastSeen: now,
        },
      ],
      rounds: [],
      submissions: [],
      votes: [],
      seen: { [hostId]: Date.now() },
    };

    writeDoc(doc);
    localStorage.setItem(codeKey(code), gameId);
    this.setMyId(gameId, hostId, true);
    this.notify(gameId);

    return { gameId, code, playerId: hostId };
  }

  async joinGame(code: string, name: string, look: CharacterLook) {
    const gameId = localStorage.getItem(codeKey(code.trim().toUpperCase()));
    if (!gameId) throw new BackendError('No game with that code.', 'no_such_game');

    const doc = readDoc(gameId);
    if (!doc) throw new BackendError('No game with that code.', 'no_such_game');

    // Rejoining from the same tab keeps the seat, the score and the character.
    const existingId = this.myId(gameId);
    const existing = existingId ? doc.players.find((p) => p.id === existingId) : undefined;

    if (existing) {
      existing.name = name.trim() || existing.name;
      existing.look = look;
      doc.seen[existing.id] = Date.now();
      writeDoc(doc);
      this.notify(gameId);
      return { gameId, playerId: existing.id };
    }

    const playerId = uid();
    doc.players.push({
      id: playerId,
      gameId,
      userId: playerId,
      name: name.trim() || 'Someone',
      look,
      isProxy: false,
      controlledBy: null,
      score: 0,
      passSpent: false,
      lastSeen: new Date().toISOString(),
    });
    doc.seen[playerId] = Date.now();
    writeDoc(doc);
    this.setMyId(gameId, playerId, false);
    this.notify(gameId);

    return { gameId, playerId };
  }

  async resume(gameId: string) {
    return { playerId: this.myId(gameId), isHost: this.amHost(gameId) };
  }

  async resolveCode(code: string) {
    return localStorage.getItem(codeKey(code.trim().toUpperCase()));
  }

  // ── reads ────────────────────────────────────────────────────────────────

  private snapshot(gameId: string): GameSnapshot | null {
    const doc = readDoc(gameId);
    if (!doc) return null;

    const me = this.myId(gameId);
    const round = doc.rounds.length > 0 ? doc.rounds[doc.rounds.length - 1] : null;

    // The sealing rules, mirroring the RLS policies exactly.
    // Sealing is a shared, tested rule — never re-implemented per backend.
    const submissions =
      round == null
        ? []
        : visibleSubmissions(
            doc.submissions.filter((s) => s.roundId === round.id),
            round.phase,
            me,
          );

    const votes =
      round == null
        ? []
        : visibleVotes(
            doc.votes.filter((v) => v.roundId === round.id),
            round.phase,
            me,
          );

    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
    const present = doc.players
      // Proxies have no device to heartbeat from; they are present by definition.
      .filter((p) => p.isProxy || (doc.seen[p.id] ?? 0) > cutoff)
      .map((p) => p.id);

    return {
      game: doc.game,
      players: doc.players,
      round,
      submissions,
      votes,
      present,
      usedCardIds: doc.rounds.map((r) => r.cardId),
      playedPlayerIds: doc.rounds
        .map((r) => r.turnPlayerId)
        .filter((id): id is string => Boolean(id)),
    };
  }

  subscribe(gameId: string, onChange: (snapshot: GameSnapshot) => void) {
    const push = () => {
      const snap = this.snapshot(gameId);
      if (snap) onChange(snap);
    };

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type: string; gameId?: string };
      if (msg.type === 'change' && msg.gameId === gameId) push();
    };
    const onLocal = (event: Event) => {
      if ((event as CustomEvent).detail?.gameId === gameId) push();
    };
    // A tab that was backgrounded when BroadcastChannel fired still catches up.
    const onStorage = (event: StorageEvent) => {
      if (event.key === gameKey(gameId)) push();
    };

    this.channel?.addEventListener('message', onMessage);
    window.addEventListener('campfire:change', onLocal);
    window.addEventListener('storage', onStorage);

    // Presence decays on a timer, so poll slowly as well as on every change.
    const tick = window.setInterval(push, 5000);
    push();

    return () => {
      this.channel?.removeEventListener('message', onMessage);
      window.removeEventListener('campfire:change', onLocal);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(tick);
    };
  }

  // ── host actions ─────────────────────────────────────────────────────────

  async addProxy(gameId: string, name: string, look: CharacterLook) {
    this.requireHost(gameId);
    const hostId = this.myId(gameId);
    this.mutate(gameId, (doc) => {
      doc.players.push({
        id: uid(),
        gameId,
        userId: null,
        name: name.trim() || 'Guest',
        look,
        isProxy: true,
        controlledBy: hostId,
        score: 0,
        passSpent: false,
        lastSeen: new Date().toISOString(),
      });
    });
  }

  async removePlayer(gameId: string, playerId: string) {
    this.requireHost(gameId);
    this.mutate(gameId, (doc) => {
      doc.players = doc.players.filter((p) => p.id !== playerId);
    });
  }

  async setPhase(gameId: string, phase: Game['phase'], heatCap?: Heat) {
    this.requireHost(gameId);
    this.mutate(gameId, (doc) => {
      doc.game.phase = phase;
      if (heatCap) doc.game.heatCap = heatCap;
    });
  }

  async startRound(gameId: string, options: StartRoundOptions) {
    this.requireHost(gameId);
    const roundId = uid();
    this.mutate(gameId, (doc) => {
      const round: Round = {
        id: roundId,
        gameId,
        idx: doc.rounds.length + 1,
        cardId: options.cardId,
        mechanic: options.mechanic,
        turnPlayerId: options.turnPlayerId ?? null,
        opponentId: options.opponentId ?? null,
        phase: options.phase,
        deadlineAt: options.secs
          ? new Date(Date.now() + options.secs * 1000).toISOString()
          : null,
        results: null,
      };
      doc.rounds.push(round);
      doc.game.roundNo = round.idx;
    });
    return roundId;
  }

  async advanceRound(roundId: string, phase: RoundPhase, secs?: number | null) {
    const gameId = this.gameIdForRound(roundId);
    this.requireHost(gameId);
    this.mutate(gameId, (doc) => {
      const round = doc.rounds.find((r) => r.id === roundId);
      if (!round) return;
      round.phase = phase;
      round.deadlineAt = secs ? new Date(Date.now() + secs * 1000).toISOString() : null;
    });
  }

  async scoreRound(roundId: string) {
    const gameId = this.gameIdForRound(roundId);
    this.requireHost(gameId);

    this.mutate(gameId, (doc) => {
      const round = doc.rounds.find((r) => r.id === roundId);
      if (!round || round.results) return;

      const subs = doc.submissions.filter((s) => s.roundId === roundId);
      const votes = doc.votes.filter((v) => v.roundId === roundId);

      let results;
      switch (round.mechanic) {
        case 'solo':
          results = scoreSolo(round.turnPlayerId ?? '', votes);
          break;
        case 'allplay':
          results = scoreAllplay(subs, votes);
          break;
        case 'guesswho':
          results = scoreGuessWho(subs, votes);
          break;
        case 'duel':
          results = scoreDuel(round.turnPlayerId ?? '', round.opponentId ?? '', votes);
          break;
      }

      for (const [playerId, points] of Object.entries(results.points)) {
        const player = doc.players.find((p) => p.id === playerId);
        if (player) player.score += points;
      }

      round.results = results;
      round.phase = 'scored';
      round.deadlineAt = null;
    });
  }

  async awardWhim(playerId: string, points: number) {
    const gameId = this.gameIdForPlayer(playerId);
    this.requireHost(gameId);
    this.mutate(gameId, (doc) => {
      const player = doc.players.find((p) => p.id === playerId);
      if (player) player.score += points;
    });
  }

  // ── player actions ───────────────────────────────────────────────────────

  async submitAnswer(roundId: string, text: string, playerId?: string) {
    const gameId = this.gameIdForRound(roundId);
    const author = playerId ?? this.myId(gameId);
    if (!author) throw new BackendError('You are not in this game.');
    if (playerId) this.requireHost(gameId);

    this.mutate(gameId, (doc) => {
      const round = doc.rounds.find((r) => r.id === roundId);
      if (!round || round.phase !== 'submitting') {
        throw new BackendError('Submissions are closed.', 'closed');
      }
      const existing = doc.submissions.find(
        (s) => s.roundId === roundId && s.playerId === author,
      );
      if (existing) {
        existing.text = text;
        return;
      }
      doc.submissions.push({
        id: uid(),
        roundId,
        playerId: author,
        text,
        createdAt: new Date().toISOString(),
      });
    });
  }

  async castVote(roundId: string, vote: VoteInput, playerId?: string) {
    const gameId = this.gameIdForRound(roundId);
    const voter = playerId ?? this.myId(gameId);
    if (!voter) throw new BackendError('You are not in this game.');
    if (playerId) this.requireHost(gameId);

    this.mutate(gameId, (doc) => {
      const round = doc.rounds.find((r) => r.id === roundId);
      if (!round || round.phase !== 'voting') {
        throw new BackendError('Voting is closed.', 'closed');
      }
      // One vote per voter per target, so guess-who can carry several.
      const existing = doc.votes.find(
        (v) =>
          v.roundId === roundId &&
          v.voterId === voter &&
          (v.targetPlayerId ?? null) === (vote.targetPlayerId ?? null),
      );
      if (existing) {
        existing.score = vote.score ?? null;
        existing.guessPlayerId = vote.guessPlayerId ?? null;
        return;
      }
      doc.votes.push({
        id: uid(),
        roundId,
        voterId: voter,
        targetPlayerId: vote.targetPlayerId ?? null,
        score: vote.score ?? null,
        guessPlayerId: vote.guessPlayerId ?? null,
      });
    });
  }

  async spendPass(gameId: string, playerId?: string) {
    const who = playerId ?? this.myId(gameId);
    if (playerId) this.requireHost(gameId);
    this.mutate(gameId, (doc) => {
      const player = doc.players.find((p) => p.id === who);
      // Costs nothing. Deliberately no score change here, ever.
      if (player) player.passSpent = true;
    });
  }

  // ── ephemeral ────────────────────────────────────────────────────────────

  react(gameId: string, emoji: string) {
    const playerId = this.myId(gameId);
    if (!playerId) return;
    const reaction: Reaction = { playerId, emoji, at: Date.now() };
    this.channel?.postMessage({ type: 'reaction', gameId, reaction });
    for (const h of this.reactionHandlers) h(reaction);
  }

  onReaction(handler: (r: Reaction) => void) {
    this.reactionHandlers.add(handler);
    return () => {
      this.reactionHandlers.delete(handler);
    };
  }

  heartbeat(gameId: string) {
    const playerId = this.myId(gameId);
    if (!playerId) return;
    const doc = readDoc(gameId);
    if (!doc) return;
    doc.seen[playerId] = Date.now();
    writeDoc(doc);
    // Deliberately no notify(): a heartbeat every few seconds from every tab
    // would otherwise re-render the whole game constantly. Subscribers poll.
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private gameIdForRound(roundId: string): string {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('campfire:game:')) continue;
      const doc = readDoc(key.replace('campfire:game:', ''));
      if (doc?.rounds.some((r) => r.id === roundId)) return doc.game.id;
    }
    throw new BackendError('That round no longer exists.', 'no_such_game');
  }

  private gameIdForPlayer(playerId: string): string {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('campfire:game:')) continue;
      const doc = readDoc(key.replace('campfire:game:', ''));
      if (doc?.players.some((p) => p.id === playerId)) return doc.game.id;
    }
    throw new BackendError('That player is no longer in the game.', 'no_such_game');
  }
}
