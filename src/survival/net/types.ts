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

  /** Room code → game id, for opening the shared screen in a second tab. */
  resolveCode(code: string): Promise<string | null>;

  subscribe(gameId: string, onChange: (snapshot: Snapshot) => void): () => void;

  // ── host only ──────────────────────────────────────────────────────────
  /** Open the current question's outcomes to the room. */
  reveal(gameId: string): Promise<void>;
  /** Next question, or next chapter. */
  advance(gameId: string): Promise<void>;

  // ── players ────────────────────────────────────────────────────────────
  answer(gameId: string, optionIndex: number): Promise<void>;
  plea(gameId: string, text: string): Promise<void>;
  vote(gameId: string, targetPlayerId: string): Promise<void>;

  heartbeat(gameId: string): void;
}

export type SurvivalErrorCode =
  | 'no_such_game'
  | 'not_host'
  | 'already_chosen'
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
