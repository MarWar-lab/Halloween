-- 0003 — anonymity, progress, and two rules that were only half enforced.
--
-- Run this in the Supabase SQL editor after 0001 and 0002. It is additive:
-- no table is dropped and no row is deleted.
--
-- Four things are wrong in 0001, all of them found by playing a round rather
-- than by reading the schema:
--
--  1. ANSWERS REVEALED THEIR AUTHOR. `submissions_read` opens the whole row at
--     `revealing`, player_id included. Row-level security cannot hide a column,
--     so every client could name the author of every "anonymous" answer before
--     voting on it. That defeats all-play and guess-who completely.
--
--  2. NOBODY COULD SEE THE PROGRESS OF A ROUND. Sealing hid the answers from
--     the host too, so the console read "0 of 9 answered" until the reveal and
--     the host had no way to know when to close submissions.
--
--  3. A SECOND VOTE DID NOT REPLACE THE FIRST. On a mechanic with one vote per
--     person, changing your mind inserted another row and you were counted
--     twice.
--
--  4. THE PASS DID NOTHING TO THE ROUND. It set a flag and left the card
--     sitting there with the room still waiting on the person who just said no.

-- ─── 1. votes point at an answer, not at a person ───────────────────────────
-- A voter is not told who wrote what, so a voter cannot name a target. They
-- send the answer they picked and the server resolves the author.

alter table public.votes
  add column if not exists submission_id uuid references public.submissions(id) on delete cascade;

create unique index if not exists votes_one_guess_per_answer
  on public.votes (round_id, voter_id, submission_id)
  where submission_id is not null;

-- ─── 2. authorship is masked until the round is scored ──────────────────────

-- "Is this player me, or somebody I am playing for?"
create or replace function public.controls(p_game uuid, p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players p
     where p.id = p_player
       and p.game_id = p_game
       and (p.id = public.my_player(p_game) or p.controlled_by = public.my_player(p_game))
  );
$$;

-- Own rows only. Everything else now comes through round_submissions(), which
-- can do what a policy cannot: return the row while withholding a column.
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions
  for select to authenticated using (
    player_id = public.my_player(public.round_game(round_id))
  );

create or replace function public.round_submissions(p_round uuid)
returns table (
  id         uuid,
  round_id   uuid,
  player_id  uuid,
  text       text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id,
         s.round_id,
         -- Your own answer keeps its name so the client can stop you voting
         -- for it. Everyone else's is anonymous until the round is scored.
         case
           -- Your own answer, and the answers of anyone you are playing for:
           -- a host typed those, so masking them back tells nobody anything
           -- and stops the console knowing which answer a proxy may not
           -- vote on.
           when public.controls(public.round_game(p_round), s.player_id) then s.player_id
           when public.round_phase(p_round) = 'scored' then s.player_id
           else null
         end as player_id,
         s.text,
         s.created_at
    from submissions s
   where s.round_id = p_round
     and public.is_member(public.round_game(p_round))
     and (
       public.controls(public.round_game(p_round), s.player_id)
       or public.round_phase(p_round) in ('revealing','voting','scored')
     )
   order by s.created_at;
$$;

-- ─── 3. who has acted this round (never what they said) ─────────────────────

create or replace function public.round_progress(p_round uuid)
returns table (submitted uuid[], voted uuid[])
language sql stable security definer set search_path = public as $$
  select
    coalesce((select array_agg(distinct s.player_id) from submissions s where s.round_id = p_round), '{}'),
    coalesce((select array_agg(distinct v.voter_id) from votes v where v.round_id = p_round), '{}')
  where public.is_member(public.round_game(p_round));
$$;

-- ─── 4. casting a vote ──────────────────────────────────────────────────────

-- The old five-argument version has to go, not just be superseded: adding
-- p_submission creates an *overload*, so both would exist, PostgREST would
-- have two candidates to choose between, and the buggy one would still be
-- callable by anything that omitted the new argument.
drop function if exists public.cast_vote(uuid, uuid, int, uuid, uuid);

create or replace function public.cast_vote(p_round uuid,
                                            p_target uuid default null,
                                            p_score int default null,
                                            p_guess uuid default null,
                                            p_voter uuid default null,
                                            p_submission uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game uuid;
  v_voter uuid;
  v_target uuid;
  v_mechanic text;
begin
  v_game := public.round_game(p_round);
  if v_game is null then raise exception 'no such round'; end if;

  if p_voter is not null then
    if not public.is_host(v_game) then raise exception 'host only'; end if;
    v_voter := p_voter;
  else
    v_voter := public.my_player(v_game);
  end if;
  if v_voter is null then raise exception 'not in this game'; end if;

  if public.round_phase(p_round) <> 'voting' then
    raise exception 'voting is closed';
  end if;

  select mechanic into v_mechanic from rounds where id = p_round;

  -- Resolve the author here, on the server. The client sent an answer id
  -- precisely because it was never told whose answer it was.
  if p_submission is not null then
    select player_id into v_target from submissions
     where id = p_submission and round_id = p_round;
    if v_target is null then raise exception 'that answer is no longer in play'; end if;
  else
    v_target := p_target;
  end if;

  if v_target is not null and v_target = v_voter then
    raise exception 'you cannot vote for your own answer';
  end if;

  if v_mechanic = 'guesswho' then
    -- The one mechanic where a person votes several times: once per answer,
    -- so a guess is always *about* an answer.
    if p_submission is null then
      raise exception 'a guess has to say which answer it is about';
    end if;
    insert into votes (round_id, voter_id, submission_id, target_player_id, score, guess_player_id)
    values (p_round, v_voter, p_submission, v_target, p_score, p_guess)
    -- The predicate has to be repeated here. Without it Postgres will not
    -- match the partial unique index and refuses the whole statement with
    -- 42P10 — at the moment someone changes a guess, mid-round.
    on conflict (round_id, voter_id, submission_id) where submission_id is not null
    do update set target_player_id = excluded.target_player_id,
                  score = excluded.score,
                  guess_player_id = excluded.guess_player_id;
  else
    -- Everywhere else you get one vote, and changing it replaces it rather
    -- than adding a second.
    delete from votes where round_id = p_round and voter_id = v_voter;
    insert into votes (round_id, voter_id, submission_id, target_player_id, score, guess_player_id)
    values (p_round, v_voter, p_submission, v_target, p_score, p_guess);
  end if;
end; $$;

-- ─── 5. the Pass ends the turn ──────────────────────────────────────────────
-- Still costs zero points — that rule is load-bearing and is not being
-- relaxed. What changes is that it now does something: the card is closed, so
-- the person who said no is not left sitting in the silence they said no to.

create or replace function public.spend_pass(p_game uuid, p_player uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid; v_round rounds;
begin
  if p_player is not null then
    if not public.is_host(p_game) then raise exception 'host only'; end if;
    v_player := p_player;
  else
    v_player := public.my_player(p_game);
  end if;
  if v_player is null then raise exception 'not in this game'; end if;

  update players set pass_spent = true where id = v_player and game_id = p_game;

  select * into v_round from rounds
   where game_id = p_game order by idx desc limit 1;

  -- Spelled out rather than `v_player in (turn, opponent)`: with a null
  -- opponent that IN yields null, not false, and null is not a value you
  -- want deciding whether a round closes.
  if found
     and v_round.results is null
     and (v_player = v_round.turn_player_id or v_player = v_round.opponent_id) then
    update rounds
       set phase = 'scored',
           deadline_at = null,
           results = jsonb_build_object(
             'points', '{}'::jsonb,
             'notes', jsonb_build_object(v_player::text, 'passed — no points, no penalty'))
     where id = v_round.id;
  end if;
end; $$;

-- ─── grants ─────────────────────────────────────────────────────────────────

grant execute on function
  public.controls(uuid, uuid),
  public.round_submissions(uuid),
  public.round_progress(uuid),
  public.cast_vote(uuid, uuid, int, uuid, uuid, uuid),
  public.spend_pass(uuid, uuid)
to authenticated;

-- PostgREST caches the schema, so without this the new functions are missing
-- from the API until something else happens to invalidate it.
notify pgrst, 'reload schema';
