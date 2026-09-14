# The Last Screen Standing — 14 September 2026

This pass changes the survival game, its regression tests, and the production
bundle checks. Changes are local; no deployment or database migration was run.

## Fixes

- Production builds now exclude the local survival simulator and all 35 sealed
  outcomes and percentages. Previously the table was downloaded even when using
  Supabase: the source import test did not prove bundle secrecy. `npm run build`
  now runs the bundle checks automatically.
- Local play remains available under `npm run dev` with `/survive?net=local`.
  An explicit `ALLOW_LOCAL_ONLY_BUILD=1 npm run build` creates an unsealed demo;
  do not use that build for the live multiplayer game. Production ignores the
  local-play query parameter and uses Supabase.
- Failed in-game actions are visible as alerts. Connection errors retain the
  last successful snapshot and polling retries rather than silently stopping.
  Refreshes are serialized and successful actions request an immediate refresh.
- Each room subscription resolves its own seat, so joining a second room does
  not reuse the first room's private-score filter. Rejoining restores host controls.
- Local late arrivals receive both the missing answers and all matching scores.
  Invalid move indices and votes for people outside the room are rejected.
- Players can see the room code and their name. Hosts have a direct shared-screen
  link, and the screen shows the joining address. The new tab uses `noopener` so
  local session storage does not duplicate the host seat.
- Host controls count outstanding pleas and votes and explicitly name missing
  submissions before closing a phase. The result has no nonfunctional Finished
  button and no longer claims the now-public survival rate is private.
- The entrance scrolls on small phones, long text wraps, and keyboard focus is visible.

## Verification

- 160 automated tests pass, including new local scoring, invalid input, reconnect,
  polling recovery, subscription ordering, and host-control regressions.
- 86 SQL checks pass against an isolated PostgreSQL-compatible PGlite database.
- Production typecheck and build pass; 9 bundle checks pass, including absence of
  every sealed outcome and the local survival simulator.
- Lint has the same 7 pre-existing Campfire warnings; none added by this pass.
- Browser playtest: two players and one independent shared screen, seven choice
  rounds, both pleas, both votes, and the tied-vote survival-rate winner. Checked
  refresh, leaving/rejoining the host, private result restoration, 375×667 phone
  layout and 1366×768 shared-screen layout. No warning/error console logs in the
  host tab. This was local play, not a fresh production multiplayer test.

The older deployed build still needs replacement to remove its bundled answer
key. No SQL change is needed for this pass. The unrelated pending Campfire
split-notes migration described in the handoff remains untouched.
