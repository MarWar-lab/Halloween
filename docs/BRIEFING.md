# The Last Screen Standing — briefing for a new agent

Read this before touching anything. It is short on purpose; the code is
commented where it matters.

## What this is

A realtime survival party game for distributed teams. Everyone plays from
their own device — there is no separate shared screen. Two zero-stakes
warm-ups, then a run of scripted questions, then a plea. Every question
offers five moves; everyone taps one; every device opens the same full
reveal — all five outcomes, each person's name against what they chose. No
voting until the very last step: an open plea, followed by one vote for a
winner.

This repo used to also serve *Campfire*, a card-drawing party game with a
procedural canvas scene, from the same deployment. Campfire has been pulled
from the site; its code is untouched in
[`archive/campfire/`](../archive/campfire), including its own briefing doc,
kept for reference rather than shipped. Nothing under `src/` imports
anything from `archive/`.

## Run it

```bash
npm run dev          # http://localhost:5173
npm test              # pure game logic: pacing, puzzles, scale, sealed answers
npx tsc -b --force    # typecheck
npm run check:sql     # applies every migration into PGlite and plays a round
npm run build
npm run verify:live   # plays a real round against live Supabase and asserts the security
```

`?net=local` forces the local backend — a full implementation in
localStorage + BroadcastChannel, per-tab identity in sessionStorage. Use it
for gameplay testing; several tabs on one machine are several people, and it
does not litter the real database. It enforces the **same** sealing rules as
Postgres, deliberately, so testing against it cannot give false confidence —
but it **cannot keep the seal**: it is one browser with no server, so every
figure it scores with ships in the bundle. That mode exists for playing the
night through before it is deployed, never for the live multiplayer game.

## Scores compound, not average

Your odds are the product of every real question's percentage, not their
mean — see `survivalOddsOf` in `src/survival/types.ts`. Surviving several
things back to back is the chance of all of them going your way at once, and
that chance falls every time, which an arithmetic mean structurally cannot
do. It also, quickly, gets very small — comparisons and tie-breaks use the
unrounded figure (`survivalOddsPrecise` / `survival_odds_precise`) for
exactly that reason, because several players routinely land on the same
rounded "0.0%" without being tied at all.

## The seal — its one load-bearing rule

**Your survival percentage is yours.** You see what your own move cost you;
nobody else does until the tribunal. That is why it has its own tables
rather than riding on shared tables that are published over Realtime — any
per-player figure on a realtime-published table is streamed to every client
no matter what the interface draws.

How it's built, in the order it matters:

1. `survival_options` holds the percentages and the prose. RLS on, **no
   policy and no grant** — two gates, both shut. Only `survival_reveal` reads
   it.
2. The public fact and the private fact are in **different tables**
   (`survival_answers`, `survival_scores`), because RLS opens a row and not a
   column. One table holding both would need a masking function nobody may
   edit wrongly.
3. Only `survival_games` and `survival_players` are in the realtime
   publication. Everything else is polled, as submissions and votes are here.
4. `survival_standings` **raises** before the tribunal. That refusal is the
   reveal.

`src/survival/sealed.ts` mirrors those values for the local backend.
`src/survival/seal.test.ts` fails the build if the mirror drifts from the
migration, and asserts that nothing but the local backend imports it.

## Invariants — do not break these

1. **Every state change goes through a `security definer` RPC.** Clients
   hold SELECT and nothing else.
2. **GRANT and POLICY are separate gates in Postgres.** Enabling RLS without
   granting SELECT fails every read with `42501` before a policy is
   consulted.
3. **Migrations widen, never narrow.** A later migration re-adding a check
   constraint must not drop an option an earlier one added.
4. **Inserting a real question mid-arc is a reseed, not a column widen.**
   The warm-ups dodge this entirely by living at negative `question_idx` — no
   stakes, no `SEALED` row, nothing to renumber. A real question needs a
   `SEALED`/`survival_options` row, so slotting one in the middle shifts
   every question after it: one migration widens the `question_idx` CHECK
   constraints, bumps `survival_advance`'s upper bound and `survival_join`'s
   backfill loop, and reseeds `survival_options` in full.
   `src/survival/questions.ts` and `sealed.ts` are reordered to match by
   hand — `seal.test.ts` cross-checks the two against whichever migration
   file it currently points at, so update that path when a later one
   supersedes it.
5. **Both backends stay in step.** A rule changed in `src/survival/` must
   change in `supabase/migrations/*.sql`, and vice versa. The local backend
   being more permissive than the real one is the most dangerous bug class
   here.

## Where things live

| | |
|---|---|
| `src/survival/Survival.tsx` | the whole game, behind one component |
| `src/survival/views/Player.tsx` | the scenario, the tap, the reveal, the tribunal board — all on one screen per person |
| `src/survival/views/Join.tsx` | the lobby / join screen |
| `src/survival/state/useSurvival.ts` | the client state machine |
| `src/survival/net/{local,supabase}.ts` | two interchangeable backends behind one interface |
| `src/survival/types.ts` | the whole vocabulary, including `survivalOddsOf` |
| `src/survival/questions.ts` | the scripted questions and warm-ups |
| `src/survival/sealed.ts` | the local mirror of the sealed percentages — local backend only |
| `src/survival/puzzles.ts` | puzzle/riddle logic |
| `src/survival/pacing.ts` | timing/pacing for the arc |
| `src/survival/scale.ts` | sizing the game to who turned up |
| `src/survival/debrief.ts` | the private per-question recap shown before the plea composer |
| `src/lib/` | shared infra: Supabase client, anonymous auth, server clock sync |
| `supabase/migrations/` | schema, RLS policies and the RPCs that own every state change |
| `scripts/check-migrations.mjs` | PGlite: applies every migration, plays a round, re-applies |
| `archive/campfire/` | the retired Campfire engine — not part of the build |

## Security

- The anon key is public by design and ships in the browser bundle. The
  **database password** and the `service_role` key must never appear in the
  repo, in `.env.local`, or in a chat transcript.
- `.env.local` is gitignored. `scripts/verify-live.py` reads credentials from
  it or the environment and hardcodes nothing.
- The build **refuses** to produce a bundle with no Supabase credentials.
  Escape hatch: `ALLOW_LOCAL_ONLY_BUILD=1`.
- The app probes the database at startup, so a database behind the build is
  caught before anyone joins rather than mid-round.

## House style

Comments explain *why*, never *what*. If a line needs a comment to say what
it does, rename something instead. Prose in the UI is written for someone
reading it on a phone thirty seconds before the first question — that is
when it will actually be read.
