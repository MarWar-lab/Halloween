# Campfire — briefing for a new agent

Read this before touching anything. It is short on purpose; the code is
commented where it matters.

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

## Run it

```bash
npm run dev          # http://localhost:5173
npm test             # 71 tests, all pure logic + one full-game integration
npx tsc -b --force   # typecheck (erasableSyntaxOnly is on: no param properties, no enums)
npm run build
npm run verify:live  # plays a real round against live Supabase and asserts the security
```

**Node 22 or newer.** The machine's default is 18 and the Vite/Rolldown stack
will not start on it: `PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH npm test`.

`?net=local` forces the local backend — a full implementation in
localStorage + BroadcastChannel, per-tab identity in sessionStorage. Use it for
all gameplay testing; it means several tabs on one machine are several people,
and it does not litter the real database. It enforces the **same** sealing
rules as Postgres, deliberately, so testing against it cannot give false
confidence.

## Invariants — do not break these

These are not style preferences. Each one has already been broken once and cost
a real bug.

1. **The Pass costs zero points. Always.** If passing costs anything, the quiet
   half of the team reads it as a trap and stops using it, and the whole design
   collapses. It is asserted in `scoring.ts`, in SQL, and in tests.

2. **An answer's author is secret until the round is scored.** Not "not
   rendered" — *not sent*. Row-level security opens a row, not a column, so
   masked reads go through `round_submissions()`, and votes reference a
   `submission_id` with the server resolving the author. A client that can name
   an author has already won guess-who.

3. **Who has acted is public; what they said is not.** The host must know when
   the room has finished writing or the game cannot be run. That is
   `submittedPlayerIds` / `votedPlayerIds` on the snapshot, and
   `round_progress()` in SQL. Never widen this to carry content.

4. **Every state change goes through a `security definer` RPC.** Clients hold
   SELECT on the tables and nothing else, so a player cannot edit their own
   score from devtools.

5. **Heat only ever climbs.** The courage dial is the spine of the evening:
   nobody is asked to perform until they have watched a dozen colleagues
   survive something smaller.

6. **If it is not your move, you get no controls — not disabled ones.** A
   disabled button still asks the reader to work out why. All of this is
   decided by `turnFor()` in `src/game/turn.ts`; add cases there rather than
   writing conditionals into the JSX.

7. **Nothing on the Stage may scroll.** The room cannot reach a scrollbar. If
   content does not fit, it must shrink or reflow.

8. **Both backends stay in step.** A rule changed in `src/game/scoring.ts` must
   change in `supabase/migrations/*.sql`, and vice versa. The local backend
   being more permissive than the real one is the most dangerous bug class in
   this repo.

## Where things live

| | |
|---|---|
| `src/game/types.ts` | the whole vocabulary; read this first |
| `src/game/machine.ts` | phase order, heat caps, which mechanics a phase draws |
| `src/game/deal.ts` | picking a card and seating it — pure, so it is testable |
| `src/game/turn.ts` | what one player is asked to do right now |
| `src/game/scoring.ts` | mirrors the SQL scoring exactly |
| `src/game/sealing.ts` | who may see what, by phase — mirrors the RLS |
| `src/game/decks/halloween.ts` | 39 cards; 25 playable with no player devices |
| `src/net/{local,supabase}.ts` | two interchangeable backends behind one interface |
| `src/scene/{character,fire}.ts` | Canvas 2D, procedural, zero image assets |
| `src/views/{Stage,Player,Host,Landing}.tsx` | the three screens plus the door |
| `supabase/migrations/` | 0001 schema, 0002 grants, 0003 anonymity |

**GRANT and POLICY are separate gates in Postgres.** Enabling RLS without
granting SELECT fails every read with `42501` before a policy is consulted.
This cost half a day once.

## State right now

Committed and green: 71 tests, typecheck clean, production build clean.

**Action required before the Supabase backend works:** run
`supabase/migrations/20260910150000_anonymity.sql` in the Supabase SQL editor.
`npm run verify:live` stops with that instruction until you do. Until it is
applied the app falls back to the local backend and says so in the UI.

Recently fixed, all found by playing rather than reading — do not reintroduce:
author leak on reveal, host seeing "0 of 9 answered" all round, guess-who
counting one guess per player instead of one per answer, a Pass that did
nothing, a duel dealt with no clock, and a proxy being offered a vote for their
own answer.

## Still open

- **Benchmarking against other virtual team-building formats** was asked for
  and has not been done. Nobody has produced it yet; do not present remembered
  impressions as research.
- Two more decks: "Everyday team" (~22 cards) and "New joiner" (~16).
- A printable pre-event page for the host.
- Accessibility pass, and a legibility pass through actual Zoom compression —
  the screen has never been checked through a real re-encode.
- Deploy to Vercel: push to GitHub, set `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, and set the Site URL in Supabase auth settings.

## Security

- The anon key is public by design and ships in the browser bundle. The
  **database password** and the `service_role` key must never appear in the
  repo, in `.env.local`, or in a chat transcript.
- `.env.local` is gitignored. `scripts/verify-live.py` reads credentials from
  it or the environment and hardcodes nothing.

## House style

Comments explain *why*, never *what*. If a line needs a comment to say what it
does, rename something instead. Prose in the UI is written for someone reading
it on a phone thirty seconds before the first card — that is when it will
actually be read.
