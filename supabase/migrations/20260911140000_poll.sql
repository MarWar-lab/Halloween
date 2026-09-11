-- 0005 — the poll, where the count of names is the answer.
--
-- Some questions do not need a second vote. "Who is most likely to decorate
-- the whole house" is answered by the tally of names; asking the room to then
-- vote on whose answer was best decides nothing that has not been decided.
-- The deck had exactly that card, as an all-play, and it made no sense.
--
-- A poll needs no new column: it votes with target_player_id, which has been
-- there since the first migration.
--
-- Safe to re-run.

alter table public.rounds drop constraint if exists rounds_mechanic_check;
alter table public.rounds
  add constraint rounds_mechanic_check
  check (mechanic in ('solo', 'allplay', 'guesswho', 'duel', 'split', 'poll'));

-- ─── naming yourself is a legitimate answer ─────────────────────────────────
-- The self-vote guard exists to stop somebody voting for their own *answer*.
-- Applied to a poll it bans the truthful reply, so it now only fires where a
-- submission is involved.

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
    if v_target = v_voter then
      raise exception 'you cannot vote for your own answer';
    end if;
  else
    v_target := p_target;
  end if;

  if v_mechanic = 'split' and p_option is null then
    raise exception 'a split vote has to name a side';
  end if;

  if v_mechanic = 'poll' and v_target is null then
    raise exception 'a poll vote has to name somebody';
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

-- ─── scoring a poll ─────────────────────────────────────────────────────────
-- Mirrors scorePoll in src/game/scoring.ts. Three to whoever the room named,
-- one for answering, one more for having read the room. A tie names both.

create or replace function public.score_poll(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_points jsonb := '{}'::jsonb;
  v_notes  jsonb := '{}'::jsonb;
  v_top int;
  r record;
begin
  for r in
    select voter_id from votes where round_id = p_round and target_player_id is not null
  loop
    v_points := v_points || jsonb_build_object(
      r.voter_id::text, coalesce((v_points ->> r.voter_id::text)::int, 0) + 1);
  end loop;

  select max(n) into v_top from (
    select count(*) as n from votes
     where round_id = p_round and target_player_id is not null
     group by target_player_id) t;

  if v_top is null then
    return jsonb_build_object('points', v_points, 'notes', v_notes);
  end if;

  for r in
    select target_player_id as pid from votes
     where round_id = p_round and target_player_id is not null
     group by target_player_id having count(*) = v_top
  loop
    v_points := v_points || jsonb_build_object(
      r.pid::text, coalesce((v_points ->> r.pid::text)::int, 0) + 3);
    v_notes := v_notes || jsonb_build_object(r.pid::text, 'named by ' || v_top::text);
  end loop;

  -- And a point to everyone who called it right.
  for r in
    select v.voter_id from votes v
     where v.round_id = p_round and v.target_player_id is not null
       and (select count(*) from votes w
             where w.round_id = p_round and w.target_player_id = v.target_player_id) = v_top
  loop
    v_points := v_points || jsonb_build_object(
      r.voter_id::text, coalesce((v_points ->> r.voter_id::text)::int, 0) + 1);
  end loop;

  return jsonb_build_object('points', v_points, 'notes', v_notes);
end; $$;

create or replace function public.score_round(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round rounds;
  v_one jsonb;
  v_results jsonb;
  r record;
begin
  select * into v_round from rounds where id = p_round;
  if not found then raise exception 'no such round'; end if;
  if not public.is_host(v_round.game_id) then raise exception 'host only'; end if;
  if v_round.results is not null then return v_round.results; end if;

  if v_round.mechanic in ('split', 'poll') then
    v_one := case when v_round.mechanic = 'split'
                  then public.score_split(p_round)
                  else public.score_poll(p_round) end;
    for r in select key, value from jsonb_each_text(v_one -> 'points') loop
      update players set score = score + r.value::int where id = r.key::uuid;
    end loop;
    v_results := jsonb_build_object(
      'points', v_one -> 'points', 'notes', v_one -> 'notes', 'authors', '{}'::jsonb);
    update rounds set results = v_results, phase = 'scored' where id = p_round;
    return v_results;
  end if;

  return public.score_round_classic(p_round);
end; $$;

grant execute on function
  public.cast_vote(uuid, uuid, int, uuid, uuid, uuid, int),
  public.score_poll(uuid),
  public.score_round(uuid)
to authenticated;

notify pgrst, 'reload schema';
