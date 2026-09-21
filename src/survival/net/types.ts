/**
 * The backend interface for The Last Screen Standing.
 *
 * Two implementations satisfy it. `supabase` is the real one, where the
 * percentages live in a table no client can read. `local` runs the whole game
 * in one browser across tabs, so the night can be played through end to end
 * before anything is deployed — it cannot keep the seal, and says so.
 *
 * The views never know which one they are talking to.
 */

import type { Snapshot } from '../types';

export interface SurvivalBackend {
  readonly kind: 'local' | 'supabase';

  /** Resolves once the backend is usable, or throws with a readable reason. */
  ready(): Promise<void>;

  create(name: string): Promise<{ gameId: string; code: string; playerId: string }>;
  join(code: string, name: string): Promise<{ gameId: string; playerId: string }>;

  /** Re-attach after a refresh, without taking a second seat. */
  resume(gameId: string): Promise<{ playerId: string | null; isHost: boolean }>;

  subscribe(gameId: string, onChange: (snapshot: Snapshot) => void, onError?: (message: string | null) => void): () => void;

  // ── host only ──────────────────────────────────────────────────────────
  /** Open the current question's outcomes to the room. */
  reveal(gameId: string): Promise<void>;
  /** Next question, or next chapter. */
  advance(gameId: string): Promise<void>;
  /**
   * Solo or consensus play. Lobby-only — teams are drawn from whoever has
   * joined the moment the briefing starts, so changing this later would
   * either strand a team mid-round or silently reshuffle one.
   */
  setMode(gameId: string, mode: 'solo' | 'consensus'): Promise<void>;

  // ── players ────────────────────────────────────────────────────────────
  answer(gameId: string, optionIndex: number): Promise<void>;
  plea(gameId: string, text: string): Promise<void>;
  vote(gameId: string, targetPlayerId: string): Promise<void>;
  /**
   * The Exchange. Three taps, deliberately — see `postFragment` in the local
   * backend for why none of them is a typed value, and why asking has to be
   * possible without a voice.
   */
  postFragment(gameId: string, berth: number): Promise<void>;
  askForBerth(gameId: string, berth: number): Promise<void>;
  solveBerth(gameId: string, berth: number, lineId: number): Promise<{ correct: boolean }>;

  /**
   * Try the extraction code. Returns whether it was accepted and, if not,
   * how many seconds until the same player may try again — never a per-digit
   * hint, never a hard lockout. A correct code is final: calling this again
   * after escaping is refused.
   */
  escape(gameId: string, code: string): Promise<{ accepted: boolean; retryInSeconds: number }>;

  heartbeat(gameId: string): void;
}

export type SurvivalErrorCode =
  | 'no_such_game'
  | 'not_host'
  | 'already_chosen'
  | 'already_escaped'
  | 'not_configured'
  | 'unknown';

export class SurvivalError extends Error {
  readonly code: SurvivalErrorCode;

  constructor(message: string, code: SurvivalErrorCode = 'unknown') {
    super(message);
    this.name = 'SurvivalError';
    this.code = code;
  }
}
