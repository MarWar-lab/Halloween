# The Last Screen Standing

A realtime survival party game for distributed teams. Everyone joins from
their own device, questions and puzzles arrive in sealed rounds, and the
group is whittled down until one screen is left standing.

This repo used to serve two games — Campfire, a card-drawing party game with
a procedural canvas scene, and this one — from the same deployment. Campfire
has been pulled from the site; its code lives untouched in
[`archive/campfire/`](archive/campfire), outside the build and the
typecheck, kept for reference rather than shipped.

## Quick start

```bash
npm install
npm run dev
```

The app runs without a backend and will tell you what's missing. To make it
playable, follow [docs/SETUP.md](docs/SETUP.md) — about fifteen minutes in the
Supabase dashboard.

```bash
npm test          # pure game logic: pacing, puzzles, scale, sealed answers
npm run build     # static build, deploys anywhere
```

## How it's put together

| Path | What's in it |
|---|---|
| `src/survival/` | The whole game: types, questions, puzzles, pacing, sealing and the phase logic, plus the views. |
| `src/survival/net/` | The realtime backend — Supabase RPCs and a local-play fallback with the same interface. |
| `src/lib/` | Shared infra: Supabase client, anonymous auth, server clock sync. |
| `supabase/migrations/` | Schema, RLS policies and the RPCs that own every state change. |
| `archive/campfire/` | The retired Campfire engine — not part of the build. |

### Worth knowing before changing anything

**Clients never write game tables.** Every mutation goes through a
`security definer` RPC that checks who's asking.

**Sealing is enforced by RLS, not by the UI.** A submission is invisible to
everyone but its author until the round reveals it. If you loosen those
policies, the sealed mechanic becomes a lie.

## Deployment

Static build, hosted on Vercel. Setup steps are at the end of
[docs/SETUP.md](docs/SETUP.md).
