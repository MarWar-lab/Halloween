# Campfire — briefing for a new agent

Read this before touching anything. It is short on purpose; the code is
commented where it matters.

Last updated 11 September 2026, after the session that took the game from
"nothing visual works" to live and playable.

## What this is

A realtime party game for distributed teams. One person screen-shares the
**Stage**; everyone else plays from a phone. Cards get drawn, answers get
sealed, the room votes, the scoreboard keeps itself.

*Campfire* is the product. *Trick or Truth* is its Halloween skin — the engine
is theme-agnostic and a theme supplies the words players see (`Trick`/`Dare`,
`Vampire's Pass`/`Pass`).

**The design problem it exists to solve:** roughly a third of any team will not
perform on camera. Everything below follows from that, so please do not
optimise it away.

**It is live.** <https://campfire-phi-lyart.vercel.app> on Vercel, against
Supabase project `imcgpjxhjdahdwgkyudt`. All five migrations are applied.

## Run it

```bash
npm run dev          # http://localhost:5173
npm test             # 110 tests
npx tsc -b --force   # typecheck (erasableSyntaxOnly: no param properties, no enums)
npm run check:sql    # 48 checks — applies every migration into PGlite and plays a round
npm run build
npm run verify:live  # plays a real round against live Supabase and asserts the security
npx vercel deploy --prod --yes   # NOT `vercel --prod`, which only prints help
```

**Node 22 or newer.** The machine's default is 18 and the Vite/Rolldown stack
will not start on it: `PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH npm test`.

`?net=local` forces the local backend — a full implementation in
localStorage + BroadcastChannel, per-tab identity in sessionStorage. Use it for
all gameplay testing; several tabs on one machine are several people, and it
does not litter the real database. It enforces the **same** sealing rules as
Postgres, deliberately, so testing against it cannot give false confidence.

## The thing this session proved, twice

**A green suite does not mean the page works.** Every defect that actually
reached the user got through a clean typecheck, a clean build, and a full green
test run, because not one of those renders a component or draws a frame:

- a white screen in the host console (React #310 — hooks below an early return)
- a canvas that threw on every single mount, twice per mount
- a card 439px tall in a 401px band
- the host's only button 208px below the fold
- a wax seal sliced in half by an `overflow: hidden` on the wrong element

**So: open the page.** Drive it with a browser, read the console, and look at a
screenshot. `src/scene/character.test.ts` now draws every pose against a stub
canvas context specifically so the "it throws while drawing" class cannot come
back silently — but it cannot tell you something is ugly or off-screen.

## Invariants — do not break these

These are not style preferences. Each has already been broken once and cost a
real bug.

1. **The Pass costs zero points. Always.** If passing costs anything, the quiet
   half of the team reads it as a trap and stops using it, and the whole design
   collapses. Asserted in `scoring.ts`, in SQL, and in tests.

2. **An answer's author is secret until the round is scored.** Not "not
   rendered" — *not sent*. Row-level security opens a row, not a column, so
   masked reads go through `round_submissions()`, and votes reference a
   `submission_id` with the server resolving the author.

3. **Who has acted is public; what they said is not.** The host must know when
   the room has finished writing or the game cannot be run. That is
   `submittedPlayerIds` / `votedPlayerIds` on the snapshot, and
   `round_progress()` in SQL. Never widen this to carry content.

4. **Every state change goes through a `security definer` RPC.** Clients hold
   SELECT and nothing else, so a player cannot edit their own score from
   devtools.

5. **Heat only ever climbs.** Nobody is asked to perform until they have
   watched a dozen colleagues survive something smaller.

6. **If it is not your move, you get no controls — not disabled ones.** A
   disabled button still asks the reader to work out why. Decided by
   `turnFor()` in `src/game/turn.ts`; add cases there rather than writing
   conditionals into the JSX.

7. **Nothing on the Stage may scroll.** The room cannot reach a scrollbar. If
   content does not fit, it must shrink or reflow.

8. **Both backends stay in step.** A rule changed in `src/game/scoring.ts` must
   change in `supabase/migrations/*.sql`, and vice versa. The local backend
   being more permissive than the real one is the most dangerous bug class here.

9. **Both screens number answers identically.** The Stage and every phone order
   answers through `src/game/ballot.ts`. They once numbered from different
   lists, so the host read "number three" aloud and half the room voted for
   something else. Your own answer stays listed and numbered — it is simply not
   votable.

10. **No card states a duration.** The clock on screen is the only duration in
    the game. A card once read "You have twenty minutes…" against a 75-second
    timer, inside a 45-minute night. Enforced by `src/game/decks/deck.test.ts`,
    which matches a number next to a unit — so "the second half" and "a
    last-minute costume" still pass. A rule nobody would keep gets deleted.

11. **Migrations widen, never narrow.** Two separate migrations re-added the
    `rounds_mechanic_check` constraint without the mechanic a *later* migration
    had added, which would have rejected existing rows on re-run. Both now use
    a DO block that only ever adds to the allowed set.

## The shape of an evening

45 minutes, held by `src/game/pacing.ts`: `TARGET_MINUTES`, `PHASE_MINUTES`
(sums to exactly 45) and `CARDS_PER_PHASE` (13 cards). `pacingFor()` returns
ahead / on-time / behind, and every screen shows it at all times.

**Two courage levels, not three.** `Heat = 1 | 2`, shown to the host as
**Gentle** ("typed answers, cameras off, nobody has to perform") and **Bold**
("people fetch things and act. Anyone can still Pass"). Three levels made any
two neighbours too close to feel, and stretched the night past its budget.

Six mechanics, in `Mechanic`:

| | what it is | flow |
|---|---|---|
| `solo` | one person performs | perform → vote → scored |
| `allplay` | everyone writes, sealed | submit → vote → scored |
| `guesswho` | match answers to people | submit → vote → scored |
| `duel` | two people, head to head | perform → vote → scored |
| `split` | pick a side; the minority scores | vote → scored |
| `poll` | name a person; the count *is* the answer | vote → scored |

`split` and `poll` are one tap and have no writing phase — they exist because
some questions ("who is most likely to host an event") are answered by the
count, and voting again on the winner makes no sense.

## Where things live

| | |
|---|---|
| `src/game/types.ts` | the whole vocabulary; read this first |
| `src/game/machine.ts` | phase order, heat caps, which mechanics a phase draws |
| `src/game/pacing.ts` | the 45-minute budget and where the night has got to |
| `src/game/deal.ts` | picking a card and seating it — pure, so it is testable |
| `src/game/turn.ts` | what one player is asked to do right now |
| `src/game/ballot.ts` | one answer order for every screen |
| `src/game/scoring.ts` | mirrors the SQL scoring exactly |
| `src/game/sealing.ts` | who may see what, by phase — mirrors the RLS |
| `src/game/decks/halloween.ts` | 63 cards; 37 playable with no player devices |
| `src/net/{local,supabase}.ts` | two interchangeable backends behind one interface |
| `src/net/simulation.test.ts` | 30 seeded full games per run, with skips and Passes |
| `src/scene/character.ts` | the articulated rig: 12 poses, every costume |
| `src/scene/cast.ts` | the staging table — phase in, poses and badges out |
| `src/scene/fire.ts` | flames, decor, the face-down deck on the ground |
| `src/views/{Stage,Player,Host,Landing}.tsx` | the three screens plus the door |
| `supabase/migrations/` | init, grants, anonymity, split, poll |
| `scripts/check-migrations.mjs` | PGlite: applies every migration, plays a round, re-applies |

**GRANT and POLICY are separate gates in Postgres.** Enabling RLS without
granting SELECT fails every read with `42501` before a policy is consulted.
This cost half a day once.

## The scene

Everything is drawn in code, every frame — no image assets. That is exactly what
lets the characters animate, and ready-made Halloween art is static.

The scene is the interface, not decoration. It carries four facts that used to
be sentences: who is here, who is away, who has acted, and **who the room is
waiting on** — a sealed note for a submitted answer, a lit candle for a cast
vote, a dark thought-bubble with three filling dots for anyone still to act.
Done and not-done are a different shape *and* a different colour, because across
nine seats through a screen-share a subtle difference is no difference.

Marks have a size floor. They used to scale with their character, so back-row
badges were about eleven pixels — illegible at exactly the headcount where a
host most needs them.

The canvas is `aria-hidden`, so every fact it shows also exists as real text: the
counts live in an `.sr-only` `aria-live` region rather than being deleted.

**Two traps in `Campfire.tsx`, both already paid for:**

- `draw` and `loop` are separate functions. When `draw` also queued the next
  frame, the eager first paint and every `ResizeObserver` callback each started
  their own animation loop, and unmount cancelled exactly one.
- The scene clock is clamped at zero. `requestAnimationFrame` reports the
  timestamp of the frame it is *already inside*, which can predate the
  `performance.now()` captured when the effect ran moments earlier in that same
  frame — so `t` goes slightly negative, `%` keeps the sign, `Math.floor(-0.01)`
  is `-1`, and `frames[-1]` is undefined. That threw twice on every mount, in
  production, invisibly.

## State right now

Green: 110 tests, 48 SQL checks, typecheck clean, lint clean (7 pre-existing
warnings, 0 errors), production build clean. Deployed and hand-verified through
lobby, briefing, warm-up and a dealt card with zero console errors.

Recently fixed, nearly all found by playing rather than reading — do not
reintroduce: author leak on reveal; host seeing "0 of 9 answered" all round;
guess-who counting one guess per player instead of one per answer; a Pass that
did nothing; a duel dealt with no clock; a proxy offered a vote for their own
answer; a Pass that overwrote `ready` and `voting` for the rest of the night;
a second tab stealing an existing seat and renaming the player; `ON CONFLICT`
against a partial unique index without repeating the predicate (`42P10`); a
grants migration that claimed to be re-runnable and was not.

## Still open

- **Benchmarking against other virtual team-building formats** was asked for and
  has not been done. Nobody has produced it; do not present remembered
  impressions as research.
- The reveal is still a list of text beside the card. The plan has scraps of
  paper rising anonymously from the cauldron and flying to their author at
  scoring — anonymity shown by motion rather than stated in a label. Split and
  poll results are still numbers rather than the room visibly dividing.
- The deal gesture: the top card of the pile flipping over into frame.
- The 140-character answer cap was agreed and never built.
- Two more decks: "Everyday team" (~22 cards) and "New joiner" (~16).
- A printable pre-event page for the host.
- Accessibility pass, and a legibility pass through actual Zoom compression —
  the screen has never been checked through a real re-encode.

## Security

- The anon key is public by design and ships in the browser bundle. The
  **database password** and the `service_role` key must never appear in the
  repo, in `.env.local`, or in a chat transcript.
- `.env.local` is gitignored. `scripts/verify-live.py` reads credentials from it
  or the environment and hardcodes nothing.
- The build **refuses** to produce a bundle with no Supabase credentials. Vite
  had been dead-code-eliminating the entire client — 209 kB smaller, no auth,
  no error. Escape hatch: `ALLOW_LOCAL_ONLY_BUILD=1`.
- The app probes the database at startup, so a database behind the build is
  caught before anyone joins rather than mid-vote.

## House style

Comments explain *why*, never *what*. If a line needs a comment to say what it
does, rename something instead. Prose in the UI is written for someone reading
it on a phone thirty seconds before the first card — that is when it will
actually be read.
