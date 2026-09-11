-- 0004 — the one-tap card, and shorter rounds.
--
-- Every mechanic so far asks a player to write a sentence or to perform in
-- front of colleagues, and roughly a third of any team will do neither. A
-- `split` card offers two options and takes one tap: nothing to compose,
-- nobody singled out, and a real answer from everyone in the room in about
-- three seconds.
--
-- Safe to re-run.

-- ─── let the table hold the new mechanic ────────────────────────────────────
-- `rounds.mechanic` carries a CHECK naming the four original mechanics, so
-- without this every split card fails at insert. Caught by running the
-- migration against a real Postgres rather than by reading it.

-- Widen, never narrow.
--
-- This used to drop the constraint and re-add it listing only the mechanics
-- this migration knew about — so re-running it after a later migration had
-- added another one narrowed the list again and was rejected by the rows that
-- later migration had allowed. A migration that claims to be safe to re-run
-- has to actually be.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'rounds_mechanic_check'
       and pg_get_constraintdef(oid) like '%''split''%'
  ) then
    alter table public.rounds drop constraint if exists rounds_mechanic_check;
    alter table public.rounds
      add constraint rounds_mechanic_check
      check (mechanic in ('solo', 'allplay', 'guesswho', 'duel', 'split'));
  end if;
end $$;

-- ─── which of the two ───────────────────────────────────────────────────────
-- Not reusing `score`. A side is not a rating, and a column that means two
-- unrelated things is how the next person introduces a bug.

alter table public.votes
  add column if not exists option_index smallint check (option_index in (0, 1));

-- ─── casting one ────────────────────────────────────────────────────────────
-- The signature grows again, so the previous one has to go rather than become
-- an overload PostgREST has to choose between.

drop function if exists public.cast_vote(uuid, uuid, int, uuid, uuid, uuid);

create or replace function public.cast_vote(p_round uuid,
                                            p_target uuid default null,
                                            p_score int default null,
                                            p_guess uuid default null,
                                            p_voter uuid default null,
                                            p_submission uuid default null,
                                            p_option int default null)
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

  if v_mechanic = 'split' and p_option is null then
    raise exception 'a split vote has to name a side';
  end if;

  if v_mechanic = 'guesswho' then
    if p_submission is null then
      raise exception 'a guess has to say which answer it is about';
    end if;
    insert into votes (round_id, voter_id, submission_id, target_player_id, score,
                       guess_player_id, option_index)
    values (p_round, v_voter, p_submission, v_target, p_score, p_guess, p_option)
    on conflict (round_id, voter_id, submission_id) where submission_id is not null
    do update set target_player_id = excluded.target_player_id,
                  score = excluded.score,
                  guess_player_id = excluded.guess_player_id,
                  option_index = excluded.option_index;
  else
    delete from votes where round_id = p_round and voter_id = v_voter;
    insert into votes (round_id, voter_id, submission_id, target_player_id, score,
                       guess_player_id, option_index)
    values (p_round, v_voter, p_submission, v_target, p_score, p_guess, p_option);
  end if;
end; $$;

-- ─── scoring one ────────────────────────────────────────────────────────────
-- Mirrors scoreSplit in src/game/scoring.ts. A point for answering, two more
-- for landing on the smaller side — the reward goes to the minority so that a
-- party game pays people for answering honestly when their answer is odd,
-- rather than for guessing where the room already is. A dead heat pays
-- everybody, because that is the best outcome a question like this can have.

create or replace function public.score_split(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_points jsonb := '{}'::jsonb;
  v_notes  jsonb := '{}'::jsonb;
  v_a int; v_b int; v_small int; v_drawn boolean;
  r record;
begin
  select count(*) filter (where option_index = 0),
         count(*) filter (where option_index = 1)
    into v_a, v_b
    from votes where round_id = p_round and option_index is not null;

  if v_a + v_b = 0 then
    return jsonb_build_object('points', v_points, 'notes', v_notes);
  end if;

  v_drawn := v_a = v_b;
  v_small := case when v_a < v_b then 0 else 1 end;

  for r in
    select voter_id, option_index from votes
     where round_id = p_round and option_index is not null
  loop
    if v_drawn or r.option_index = v_small then
      v_points := v_points || jsonb_build_object(r.voter_id::text, 3);
      v_notes := v_notes || jsonb_build_object(
        r.voter_id::text, case when v_drawn then 'split down the middle' else 'with the few' end);
    else
      v_points := v_points || jsonb_build_object(r.voter_id::text, 1);
    end if;
  end loop;

  return jsonb_build_object('points', v_points, 'notes', v_notes);
end; $$;

-- The original scorer, renamed and kept verbatim so the four existing
-- mechanics are provably untouched by this migration. The host check moves to
-- the dispatcher, which is the only caller.
create or replace function public.score_round_classic(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round   rounds;
  v_points  jsonb := '{}'::jsonb;
  v_notes   jsonb := '{}'::jsonb;
  v_authors jsonb := '{}'::jsonb;
  r record;
  v_median numeric;
begin
  select * into v_round from rounds where id = p_round;
  if not found then raise exception 'no such round'; end if;
  if v_round.results is not null then return v_round.results; end if;

  if v_round.mechanic = 'solo' then
    -- Median, not mean: one troll and one loyalist cannot move it.
    select percentile_cont(0.5) within group (order by score)
      into v_median
      from votes
     where round_id = p_round and score is not null
       and voter_id <> coalesce(v_round.turn_player_id, '00000000-0000-0000-0000-000000000000'::uuid);

    v_points := jsonb_build_object(
      v_round.turn_player_id::text, coalesce(round(v_median), 0)::int);
    v_notes := jsonb_build_object(
      v_round.turn_player_id::text,
      case when v_median is null then 'no votes cast'
           else 'median ' || v_median::text end);

  elsif v_round.mechanic = 'allplay' then
    -- A point for submitting, two per vote received.
    for r in select player_id, id from submissions where round_id = p_round loop
      v_points := v_points || jsonb_build_object(r.player_id::text, 1);
      v_authors := v_authors || jsonb_build_object(r.id::text, r.player_id::text);
    end loop;

    for r in
      select target_player_id as pid, count(*)::int as n
        from votes
       where round_id = p_round
         and target_player_id is not null
         and target_player_id <> voter_id
       group by target_player_id
    loop
      v_points := v_points || jsonb_build_object(
        r.pid::text, coalesce((v_points ->> r.pid::text)::int, 0) + r.n * 2);
      v_notes := v_notes || jsonb_build_object(
        r.pid::text, r.n::text || ' vote' || case when r.n = 1 then '' else 's' end);
    end loop;

  elsif v_round.mechanic = 'guesswho' then
    -- Two for a correct guess; one to the author for everyone they fooled.
    for r in select player_id from submissions where round_id = p_round loop
      v_points := v_points || jsonb_build_object(r.player_id::text,
        coalesce((v_points ->> r.player_id::text)::int, 0));
    end loop;

    for r in
      select voter_id, target_player_id, guess_player_id
        from votes
       where round_id = p_round and guess_player_id is not null
         and target_player_id is not null
    loop
      if r.guess_player_id = r.target_player_id then
        v_points := v_points || jsonb_build_object(r.voter_id::text,
          coalesce((v_points ->> r.voter_id::text)::int, 0) + 2);
      else
        v_points := v_points || jsonb_build_object(r.target_player_id::text,
          coalesce((v_points ->> r.target_player_id::text)::int, 0) + 1);
      end if;
    end loop;

  elsif v_round.mechanic = 'duel' then
    declare
      v_a int; v_b int;
      a uuid := v_round.turn_player_id;
      b uuid := v_round.opponent_id;
    begin
      select count(*) into v_a from votes where round_id = p_round and target_player_id = a;
      select count(*) into v_b from votes where round_id = p_round and target_player_id = b;

      v_points := jsonb_build_object(a::text, 1, b::text, 1);
      if v_a > v_b then
        v_points := jsonb_set(v_points, array[a::text], to_jsonb(4));
      elsif v_b > v_a then
        v_points := jsonb_set(v_points, array[b::text], to_jsonb(4));
      else
        -- A draw splits the prize. Sudden death is fun with two extroverts and
        -- miserable with anyone else.
        v_points := jsonb_build_object(a::text, 2, b::text, 2);
      end if;
      v_notes := jsonb_build_object(a::text, v_a::text || ' votes',
                                    b::text, v_b::text || ' votes');
    end;
  end if;

  -- Apply to running totals.
  for r in select key, value from jsonb_each_text(v_points) loop
    update players set score = score + r.value::int where id = r.key::uuid;
  end loop;

  update rounds
     set results = jsonb_build_object('points', v_points, 'notes', v_notes,
                                      'authors', v_authors),
         phase = 'scored'
   where id = p_round;

  return jsonb_build_object('points', v_points, 'notes', v_notes, 'authors', v_authors);
end; $$;

-- Fold it into the round scorer.
create or replace function public.score_round(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_split jsonb;
  v_results jsonb;
  r record;
begin
  select * into v_round from rounds where id = p_round;
  if not found then raise exception 'no such round'; end if;
  if not public.is_host(v_round.game_id) then raise exception 'host only'; end if;
  if v_round.results is not null then return v_round.results; end if;

  if v_round.mechanic = 'split' then
    v_split := public.score_split(p_round);
    for r in select key, value from jsonb_each_text(v_split -> 'points') loop
      update players set score = score + r.value::int where id = r.key::uuid;
    end loop;
    v_results := jsonb_build_object(
      'points', v_split -> 'points', 'notes', v_split -> 'notes', 'authors', '{}'::jsonb);
    update rounds set results = v_results, phase = 'scored' where id = p_round;
    return v_results;
  end if;

  -- Everything else is unchanged.
  return public.score_round_classic(p_round);
end; $$;

grant execute on function
  public.cast_vote(uuid, uuid, int, uuid, uuid, uuid, int),
  public.score_split(uuid),
  public.score_round_classic(uuid),
  public.score_round(uuid)
to authenticated;

notify pgrst, 'reload schema';
