import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * False until docs/SETUP.md has been followed. The app renders a helpful page
 * in that state rather than throwing — a blank screen with a console error is
 * the worst possible first-run experience.
 */
export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Players never see a login screen; the session in localStorage is what
        // lets a refresh mid-round restore their seat, score and character.
        storageKey: 'campfire.auth',
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

/**
 * Every device gets a real auth token without anyone typing anything. This is
 * what the row-level security policies key on — without it there is no
 * `auth.uid()` and every policy denies.
 */
export async function ensureSession() {
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Overwhelmingly the cause is anonymous sign-ins being switched off in the
    // dashboard, so say so rather than surfacing a bare 422.
    throw new Error(
      `Anonymous sign-in failed (${error.message}). Check Authentication → Sign In / Providers → Anonymous sign-ins is enabled — see docs/SETUP.md step 2.`,
    );
  }
  return signedIn.session;
}
