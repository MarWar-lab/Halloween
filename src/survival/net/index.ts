/**
 * Which backend is in play.
 *
 * `?net=local` forces the in-browser one — the sanctioned way to play a whole
 * night solo across several tabs without touching the real database. It is
 * also the only mode where the percentages are not really sealed, so it is an
 * explicit opt-in rather than a fallback anyone can land in by accident.
 */

import { isConfigured } from '../../lib/supabase';
import { LocalSurvivalBackend } from './local';
import { SupabaseSurvivalBackend } from './supabase';
import type { SurvivalBackend } from './types';

let cached: SurvivalBackend | null = null;

export function survivalBackend(): SurvivalBackend {
  if (cached) return cached;
  const forced = new URLSearchParams(window.location.search).get('net');
  cached =
    forced === 'local' || !isConfigured
      ? new LocalSurvivalBackend()
      : new SupabaseSurvivalBackend();
  return cached;
}

export const isLocalPlay = (): boolean => survivalBackend().kind === 'local';
