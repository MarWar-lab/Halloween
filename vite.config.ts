/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Refuse to build a deployable bundle that cannot reach Supabase.
 *
 * `isConfigured` resolves to a compile-time `false` when the variables are
 * absent, so Rollup does not merely skip the client — it deletes it. The
 * output is 200 kB smaller and physically incapable of talking to the
 * database, and the only symptom is that everyone has to be in tabs on one
 * machine. That is a miserable thing to discover during an event, and adding
 * the variables afterwards does nothing until something triggers a rebuild.
 *
 * Local-only is a real mode, not a mistake, so there is a way to say so out
 * loud: ALLOW_LOCAL_ONLY_BUILD=1.
 */
function requireSupabaseEnv(mode: string): Plugin {
  return {
    name: 'campfire:require-supabase-env',
    apply: 'build',
    configResolved() {
      const env = loadEnv(mode, process.cwd(), '')
      const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])
      if (missing.length === 0 || env.ALLOW_LOCAL_ONLY_BUILD === '1') return

      throw new Error(
        `\n\n  Cannot build: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.\n\n` +
          '  Without them the Supabase client is stripped out of the bundle entirely,\n' +
          '  and the deployed game silently works only for tabs on one machine.\n\n' +
          '  On Vercel: Settings -> Environment Variables, then redeploy. Editing a\n' +
          '  variable does not rebuild on its own.\n\n' +
          '  Building a deliberately local-only copy? ALLOW_LOCAL_ONLY_BUILD=1 npm run build\n',
      )
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), requireSupabaseEnv(mode)],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}))
