/**
 * The backend interface.
 *
 * Two implementations satisfy it: `local` (in-memory, shared across browser
 * tabs by BroadcastChannel) and `supabase` (Postgres + RLS + Realtime). The
 * views never know which one they are talking to.
 *
 * The local backend is not a stub. It is how the game gets played and tested
 * before any credentials exist, and how the whole flow can be exercised solo:
 * open the Stage in one tab and three players in three more.
 */

import type {
  CharacterLook,
  Game,
  Heat,
  Lane,
  Mechanic,
  Player,
  Round,
  RoundPhase,
  Submission,
  Vote,
} from '../game/types';

export interface GameSnapshot {
  game: Game;
  players: Player[];
  round: Round | null;
  /** Only what this viewer is allowed to see at the current phase. */
  submissions: Submission[];
  votes: Vote[];
  /**
   * Who has answered and who has voted this round — never what they said.
   *
   * The host has to know when the room is done in order to run the game at
   * all, and sealing hides the content, not the fact that someone finished.
   * Without this the console reads "0 of 9 answered" for the whole round.
   */
  submittedPlayerIds: string[];
  votedPlayerIds: string[];
  /** Player ids seen recently. Drives "away" in the scene. */
  present: string[];
  /** Cards already dealt this game, so none is drawn twice. */
  usedCardIds: string[];
  /** Who has had a solo turn, so everyone plays before anyone repeats. */
  playedPlayerIds: string[];
}

export interface StartRoundOptions {
  cardId: string;
  mechanic: Mechanic;
  lane?: Lane;
  turnPlayerId?: string | null;
  opponentId?: string | null;
  phase: RoundPhase;
  secs?: number | null;
}

export interface VoteInput {
  /**
   * The answer being voted for. Preferred over `targetPlayerId` wherever the
   * voter is choosing between anonymous answers: the client is not told who
   * wrote them, so it cannot name a target, and the server resolves the author.
   */
  submissionId?: string | null;
  /** Duel only, where the two contestants are named on screen anyway. */
  targetPlayerId?: string | null;
  /** split: which of the card's two options, 0 or 1. */
  optionIndex?: number | null;
  score?: number | null;
  guessPlayerId?: string | null;
}

export interface Reaction {
  playerId: string;
  emoji: string;
  at: number;
}

export interface Backend {
  readonly kind: 'local' | 'supabase';

  /** Resolves once the backend is usable, or throws with a readable reason. */
  ready(): Promise<void>;

  createGame(deckId: string, themeId: string, hostName: string, look: CharacterLook): Promise<{
    gameId: string;
    code: string;
    playerId: string;
  }>;

  joinGame(code: string, name: string, look: CharacterLook): Promise<{
    gameId: string;
    playerId: string;
  }>;

  /** Re-attach after a refresh, without creating a second seat. */
  resume(gameId: string): Promise<{ playerId: string | null; isHost: boolean }>;

  /** Room code → game id, for opening the Stage in a second tab. */
  resolveCode(code: string): Promise<string | null>;

  subscribe(gameId: string, onChange: (snapshot: GameSnapshot) => void): () => void;

  // ── host-only ──────────────────────────────────────────────────────────
  addProxy(gameId: string, name: string, look: CharacterLook): Promise<void>;
  removePlayer(gameId: string, playerId: string): Promise<void>;
  setPhase(gameId: string, phase: Game['phase'], heatCap?: Heat): Promise<void>;
  startRound(gameId: string, options: StartRoundOptions): Promise<string>;
  advanceRound(roundId: string, phase: RoundPhase, secs?: number | null): Promise<void>;
  scoreRound(roundId: string): Promise<void>;
  awardWhim(playerId: string, points: number): Promise<void>;

  // ── players (host may act for a proxy by passing playerId) ─────────────
  submitAnswer(roundId: string, text: string, playerId?: string): Promise<void>;
  castVote(roundId: string, vote: VoteInput, playerId?: string): Promise<void>;
  spendPass(gameId: string, playerId?: string): Promise<void>;

  // ── ephemeral ──────────────────────────────────────────────────────────
  react(gameId: string, emoji: string): void;
  onReaction(handler: (r: Reaction) => void): () => void;
  heartbeat(gameId: string): void;
}

/** Thrown for conditions the UI should explain rather than swallow. */
export type BackendErrorCode =
  | 'no_such_game'
  | 'not_host'
  | 'closed'
  | 'not_configured'
  | 'unknown';

export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(message: string, code: BackendErrorCode = 'unknown') {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}

export type { Game, Player, Round, Submission, Vote };
