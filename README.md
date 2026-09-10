# Campfire

A realtime party game for distributed teams. Everyone sits around a fire as a
character; cards get drawn, answers get sealed, the room votes, and the
scoreboard keeps itself.

Built around one constraint: **a third of any team will not perform on camera.**
So the campfire does the performing for them. Your character stands when it's
your turn, turns to whoever is speaking, laughs, gasps and holds up a voting
paddle — and the highest-value game mechanic (sealed all-play) lets the quietest
person on the call win the night without ever unmuting.

*Trick or Truth* is the Halloween season pack — the launch deck over a generic
engine.

## Quick start

```bash
npm install
npm run dev
```

The app runs without a backend and will tell you what's missing. To make it
playable, follow [docs/SETUP.md](docs/SETUP.md) — about fifteen minutes in the
Supabase dashboard.

```bash
npm test          # pure game logic: scoring, phase machine, deck integrity
npm run build     # static build, deploys anywhere
```

## How it's put together

| Path | What's in it |
|---|---|
| `src/game/` | Types, decks, themes, and the **pure** logic — scoring and the phase machine. No I/O, so it's all unit-testable. |
| `src/game/decks/` | Cards as data. Editing a joke needs no migration. |
| `src/scene/` | The canvas campfire: procedural characters, fire, backdrop. Zero image assets. |
| `src/lib/` | Supabase client, anonymous auth, server clock sync. |
| `supabase/migrations/` | Schema, RLS policies and the RPCs that own every state change. |

### Three things worth knowing before changing anything

**Scoring lives in two places on purpose.** `src/game/scoring.ts` and the
`score_round` RPC implement the same rules — TypeScript for instant previews and
tests, SQL as the authority. Change a rule, change both.

**Clients never write game tables.** Every mutation goes through a
`security definer` RPC that checks who's asking. That's why the leaderboard can
be trusted.

**Sealing is enforced by RLS, not by the UI.** A submission is invisible to
everyone but its author until the round reaches `revealing`; a vote until
`scored`. If you loosen those policies, the all-play mechanic becomes a lie.

### Two rules that are design, not implementation detail

- **Heat only ever climbs.** Cards carry a heat rating 1–3 and the phase machine
  raises the cap across the evening, never lowers it. Nobody is asked to perform
  until they've watched a dozen colleagues survive something smaller.
- **Spending a Pass costs zero points.** Enforced in the engine. If passing costs
  anything, the quiet half of the team reads it as a trap and stops using it.

## Deployment

Static build, hosted on Vercel. Setup steps are at the end of
[docs/SETUP.md](docs/SETUP.md).
