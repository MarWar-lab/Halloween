import { lazy } from 'react'

/*
 * Two games, one deployment.
 *
 * `/survive` is The Last Screen Standing; everything else is Campfire. They
 * share the anonymous sign-in, the Supabase project and this entry point, and
 * nothing else — separate tables, separate engines, separate stylesheets.
 *
 * They are LAZY on purpose, and it is not about bundle size. CSS has no scope:
 * App.css defines a generic `.setup`, so does the survival screen, and the one
 * that wins is whichever loaded last. Loading one game or the other makes that
 * collision impossible rather than unlikely.
 *
 * EACH lazy() MUST WRAP EXACTLY ONE STATIC import(). The obvious spelling —
 *
 *     lazy(() => isSurvival ? import('./survival/Survival') : import('./App'))
 *
 * — builds and runs perfectly in dev and is broken in production. The bundler
 * works out which files a chunk needs by reading the import() call site, and a
 * ternary gives it two answers: it stapled App.css to the entry so it loaded on
 * every page, and emitted survival.css as a chunk nothing referenced, so it
 * never loaded at all. The deployed survival screen rendered in Campfire's
 * colours. Nothing failed — not the types, not the tests, not the build.
 * scripts/check-bundle.mjs now fails the build if any stylesheet is orphaned
 * like that again.
 *
 * vercel.json already rewrites every path here, so this needs no router.
 */
const isSurvival = window.location.pathname.replace(/\/+$/, '') === '/survive'

const Campfire = lazy(() => import('./App.tsx'))
const Survival = lazy(() => import('./survival/Survival.tsx'))

export const Root = isSurvival ? Survival : Campfire
