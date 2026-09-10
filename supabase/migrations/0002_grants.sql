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
--
-- Granted by name rather than by signature, over whatever overloads exist. A
-- literal signature list stops being true the moment a later migration
-- changes an argument — 0003 adds one to cast_vote — and then this file
-- fails on a re-run while claiming above that it is safe to re-run.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_game', 'join_game', 'add_proxy', 'heartbeat', 'set_phase',
         'start_round', 'advance_round', 'submit_answer', 'cast_vote',
         'spend_pass', 'award_whim', 'score_round', 'server_now',
         'controls', 'round_submissions', 'round_progress'
       )
  loop
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;
