-- ============================================================================
-- Campfire — table privileges
--
-- 0001 enabled row-level security and wrote the policies, but never granted
-- the underlying table privileges. Those are two separate things in Postgres
-- and both are required:
--
--   GRANT   decides whether you may touch the table at all
--   POLICY  decides which rows you see once you may
--
-- Without the grant every read fails with 42501 "permission denied" before a
-- policy is ever consulted — which is what the live verification caught.
--
-- Only SELECT is granted, and only to `authenticated` (anonymous sign-in
-- issues that role). No INSERT, UPDATE or DELETE to anyone: every write goes
-- through the security-definer RPCs, so a player cannot alter their own score
-- even if a policy were wrong. Defence in depth, and it costs nothing.
--
-- Safe to re-run. Redundant on a fresh database, where 0001 now does this too.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant select on table
  public.games,
  public.players,
  public.rounds,
  public.submissions,
  public.votes
to authenticated;

-- Functions are already granted in 0001; repeated here so this file alone is
-- enough to repair a database where 0001 ran before the grants existed.
grant execute on function
  public.create_game(text, text),
  public.join_game(text, text, jsonb),
  public.add_proxy(uuid, text, jsonb),
  public.heartbeat(uuid),
  public.set_phase(uuid, text, int),
  public.start_round(uuid, text, text, text, uuid, uuid, text, int),
  public.advance_round(uuid, text, int),
  public.submit_answer(uuid, text, uuid),
  public.cast_vote(uuid, uuid, int, uuid, uuid),
  public.spend_pass(uuid, uuid),
  public.award_whim(uuid, int),
  public.score_round(uuid),
  public.server_now()
to authenticated;
