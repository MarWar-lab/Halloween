import { lazy } from 'react'

/*
 * Two games, one deployment.
 *
 * `/survive` is The Last Screen Standing; everything else is Campfire. They
 * share the anonymous sign-in, the Supabase project and this entry point, and
 * nothing else — separate tables, separate engines, separate stylesheets.
 *
 * They are LAZY on purpose, and it is not about bundle size. A static import
 * of both loads both stylesheets, and CSS has no scope: App.css defines a
 * generic `.setup`, the survival screen has a `.setup`, and the one that wins
 * is whichever was bundled last. That is a bug with no error message and no
 * obvious cause, and it will keep happening as both games grow class names.
 * Loading one or the other makes it impossible instead of unlikely.
 *
 * vercel.json already rewrites every path to this page, so the route needs no
 * server configuration and no router.
 */
const isSurvival = window.location.pathname.replace(/\/+$/, '') === '/survive'

export const Root = lazy(() =>
  isSurvival ? import('./survival/Survival.tsx') : import('./App.tsx'),
)
