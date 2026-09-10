import { isConfigured } from '../lib/supabase';
import { LocalBackend } from './local';
import { BackendError, type Backend } from './types';

export * from './types';

export interface Connection {
  backend: Backend;
  kind: 'local' | 'supabase';
  /** Set when Supabase was wanted but could not be used. */
  fellBackFrom?: string;
}

let cached: Promise<Connection> | null = null;

/**
 * Pick a backend.
 *
 * Supabase when it is configured and actually working; the local backend
 * otherwise — including when the schema has not been applied yet. Falling back
 * rather than erroring means the game is always playable, and the reason is
 * surfaced in the UI rather than swallowed.
 *
 * `?net=local` forces the local backend, which is also how you run a throwaway
 * game without touching the real database.
 */
export function connect(): Promise<Connection> {
  if (cached) return cached;

  cached = (async (): Promise<Connection> => {
    const forced = new URLSearchParams(window.location.search).get('net');

    if (forced === 'local' || !isConfigured) {
      return {
        backend: new LocalBackend(),
        kind: 'local',
        fellBackFrom: forced === 'local' ? undefined : 'Supabase is not configured.',
      };
    }

    try {
      const { SupabaseBackend } = await import('./supabase');
      const backend = new SupabaseBackend();
      await backend.ready();
      return { backend, kind: 'supabase' };
    } catch (err) {
      const reason =
        err instanceof BackendError || err instanceof Error
          ? err.message
          : 'Supabase is unavailable.';
      return { backend: new LocalBackend(), kind: 'local', fellBackFrom: reason };
    }
  })();

  return cached;
}
