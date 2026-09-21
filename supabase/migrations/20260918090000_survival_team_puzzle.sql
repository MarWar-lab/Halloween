-- Two more ways consensus mode reaches all the way to the finale, not just
-- the nine rounds of moral choices.
--
-- 1. SPLIT CLUES. Today every clued round's digit is visible to any member
--    the instant it's current — fine for solo play, but it means a team that
--    shares every trivia answer still solves the extraction code as nine
--    individuals who each happen to be looking at the same phone screen.
--    From here on, in consensus mode, each clued round is handed to exactly
--    one randomly-chosen member of each team — a "seer" — drawn once,
--    alongside the teams themselves. Everyone else on that team is told WHO
--    to ask, never the digit. Assembling the code now takes a conversation,
--    not just a good memory.
--
-- 2. SHARED ESCAPE. The keypad becomes a team keypad: a wrong guess by any
--    member starts the cooldown for the whole team (same as one shared
--    keypad would), and a correct one seats the WHOLE team at once, not
--    just whoever typed it — sharing every clue only to have one person
--    sprint off alone never sat right. If a team's size outgrows the seats
--    still open when they solve it, the extras aren't picked arbitrarily:
--    the whole team ties for what's left, `contested`, exactly like an
--    unsplittable vote already does.
--
-- Safe to re-run.

-- ─── tables ─────────────────────────────────────────────────────────────────

-- Not a secret who's assigned to see what — same reasoning as
-- survival_team_members: harmless to disclose, and the client needs it to
-- render "ask so-and-so" for anyone who isn't the seer.
create table if not exists public.survival_clue_seers (
  game_id      uuid not null references public.survival_games(id) on delete cascade,
  team_no      int not null,
  question_idx int not null check (question_idx between 0 and 8),
  player_id    uuid not null references public.survival_players(id) on delete cascade,
  primary key (game_id, team_no, question_idx)
);

alter table public.survival_clue_seers enable row level security;

drop policy if exists survival_clue_seers_select on public.survival_clue_seers;
create policy survival_clue_seers_select on public.survival_clue_seers
  for select using (public.survival_is_member(game_id));

grant select on public.survival_clue_seers to authenticated;

-- solve_order is no longer unique per game: a team that escapes together
-- shares one batch number across every member. Ties are now something
-- survival_seats has to handle on Path A too, same as it already does on
-- Path B for an unsplittable vote.
drop index if exists public.survival_escapes_order_idx;

-- ─── who sees what, and who to ask instead ─────────────────────────────────

/**
 * My own team's seer for a given clued round — null if I'm on no team (solo
 * mode, or a teamless late joiner). Granted directly to `authenticated`,
 * unlike most of this schema's internal helpers: it's called from inside
 * the survival_clue_digits RLS policy below, which runs as the querying
 * role, not as this function's own security-definer body — and it reveals
 * nothing survival_team_members doesn't already.
 */
create or replace function public.survival_my_clue_seer(p_game uuid, p_idx int)
returns uuid language sql security definer stable set search_path = public as $$
  select s.player_id
    from survival_clue_seers s
    join survival_team_members t on t.game_id = s.game_id and t.team_no = s.team_no
   where s.game_id = p_game and s.question_idx = p_idx
     and t.player_id = public.survival_my_player(p_game);
$$;
grant execute on function public.survival_my_clue_seer(uuid, int) to authenticated;

/**
 * Read alongside survival_clue_digits: when that query comes back empty
 * because I'm not this round's seer, this names who on my team is — so the
 * client can render "ask <name>" instead of silence with no explanation.
 * Null whenever there's nothing to ask about (no clue this round, I AM the
 * seer, or I'm not on a team at all).
 */
create or replace function public.survival_current_clue_seer(p_game uuid)
returns text language sql security definer stable set search_path = public as $$
  select p.name
    from survival_games g
    join survival_clue_seers s on s.game_id = g.id and s.question_idx = g.question_idx
    join survival_team_members t on t.game_id = s.game_id and t.team_no = s.team_no
    join survival_players p on p.id = s.player_id
   where g.id = p_game
     and g.phase = 'running'
     and t.player_id = public.survival_my_player(p_game)
     and s.player_id <> public.survival_my_player(p_game);
$$;
grant execute on function public.survival_current_clue_seer(uuid) to authenticated;

-- The digit itself now also checks the seer assignment in consensus mode.
drop policy if exists survival_clue_digits_read on public.survival_clue_digits;
create policy survival_clue_digits_read on public.survival_clue_digits
  for select to authenticated using (
    public.survival_is_member(game_id)
    and public.survival_current(game_id, question_idx)
    and (
      (select mode from survival_games where id = game_id) <> 'consensus'
      or public.survival_my_clue_seer(game_id, question_idx) is null
      or public.survival_my_clue_seer(game_id, question_idx) = public.survival_my_player(game_id)
    )
  );

-- ─── survival_assign_teams: draw each team's seers alongside the team ──────
--
-- Random, not join order: who ends up with whom must never be something a
-- group of friends could arrange by controlling when they join the lobby.
create or replace function public.survival_assign_teams(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_n int;
  v_teams int;
  v_start int;
  v_end int;
  t int;
  i int;
  q int;
  v_team_ids uuid[];
  clued constant int[] := array[0, 1, 3, 4, 5, 6, 8];
begin
  if exists (select 1 from survival_team_members where game_id = p_game) then return; end if;

  select array_agg(id order by random()) into v_ids
    from survival_players where game_id = p_game;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return; end if;

  v_teams := greatest(1, v_n / 2);
  for t in 0 .. v_teams - 1 loop
    v_start := t * 2;
    v_end := case when t = v_teams - 1 then v_n else v_start + 2 end;
    for i in v_start + 1 .. v_end loop
      insert into survival_team_members (game_id, team_no, player_id)
      values (p_game, t + 1, v_ids[i]);
    end loop;

    select array_agg(player_id) into v_team_ids
      from survival_team_members where game_id = p_game and team_no = t + 1;

    foreach q in array clued loop
      insert into survival_clue_seers (game_id, team_no, question_idx, player_id)
      values (p_game, t + 1, q, v_team_ids[1 + floor(random() * array_length(v_team_ids, 1))::int])
      on conflict (game_id, team_no, question_idx) do nothing;
    end loop;
  end loop;
end; $$;

-- ─── survival_escape: a team's tap fans out to attempts AND seats ──────────
create or replace function public.survival_escape(p_game uuid, p_attempt text)
returns table (correct boolean, solve_order int, retry_in_seconds int)
language plpgsql security definer set search_path = public as $$
declare
  RETRY_SECONDS constant int := 5;
  v_game survival_games;
  v_player uuid;
  v_team_no int;
  v_team_ids uuid[];
  v_norm text;
  v_expected text;
  v_last timestamptz;
  v_correct boolean;
  v_order int;
begin
  select * into v_game from survival_games where id = p_game for update;
  if not found then raise exception 'no such game'; end if;
  if v_game.phase not in ('running', 'plea', 'tribunal') then
    raise exception 'the keypad is dark right now';
  end if;

  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;

  if exists (select 1 from survival_escapes where game_id = p_game and player_id = v_player) then
    raise exception 'you are already aboard';
  end if;

  if not exists (select 1 from survival_keys where game_id = p_game) then
    raise exception 'this room has no extraction code';
  end if;

  if v_game.mode = 'consensus' then
    select team_no into v_team_no from survival_team_members
     where game_id = p_game and player_id = v_player;
  end if;
  if v_team_no is not null then
    select array_agg(player_id) into v_team_ids from survival_team_members
     where game_id = p_game and team_no = v_team_no;
  else
    v_team_ids := array[v_player];
  end if;

  v_norm := regexp_replace(coalesce(p_attempt, ''), '[^0-9]', '', 'g');
  if v_norm = '' then raise exception 'type something'; end if;

  select max(created_at) into v_last from survival_attempts
   where game_id = p_game and player_id = any(v_team_ids) and not survival_attempts.correct;
  if v_last is not null and v_last > now() - make_interval(secs => RETRY_SECONDS) then
    raise exception 'the keypad is still resetting';
  end if;

  select code into v_expected from survival_keys where game_id = p_game;
  v_correct := v_norm = v_expected;

  insert into survival_attempts (game_id, player_id, attempt, correct)
  values (p_game, v_player, v_norm, v_correct);

  if not v_correct then
    return query select false, null::int, RETRY_SECONDS;
    return;
  end if;

  -- One shared batch number for the whole team, not one row each with its
  -- own — survival_seats groups escapees by this number precisely so a team
  -- that solves it together either all get a seat or all share the last
  -- one, never an arbitrary subset picked by insertion order.
  v_order := 1 + (select count(distinct survival_escapes.solve_order) from survival_escapes where game_id = p_game);
  insert into survival_escapes (game_id, player_id, solve_order)
  select p_game, m, v_order from unnest(v_team_ids) as m
  on conflict (game_id, player_id) do nothing;

  return query select true, v_order, 0;
end; $$;

-- ─── survival_progress: the shared cooldown, and a team-attempt count ──────
drop function if exists public.survival_progress(uuid);
create or replace function public.survival_progress(p_game uuid)
returns table (
  answered uuid[], pleaded uuid[], voted uuid[], escaped uuid[],
  retry_in_seconds int, team_attempts int
)
language plpgsql security definer stable set search_path = public as $$
declare
  RETRY_SECONDS constant int := 5;
  v_me uuid;
  v_mode text;
  v_team_no int;
  v_team_ids uuid[];
  v_last timestamptz;
  v_retry int;
  v_team_attempts int;
begin
  if not public.survival_is_member(p_game) then return; end if;

  v_me := public.survival_my_player(p_game);
  select mode into v_mode from survival_games where id = p_game;
  if v_mode = 'consensus' then
    select team_no into v_team_no from survival_team_members
     where game_id = p_game and player_id = v_me;
  end if;
  if v_team_no is not null then
    select array_agg(player_id) into v_team_ids from survival_team_members
     where game_id = p_game and team_no = v_team_no;
  else
    v_team_ids := array[v_me];
  end if;

  select max(created_at) into v_last from survival_attempts
   where game_id = p_game and player_id = any(v_team_ids) and not correct;
  if v_last is null then
    v_retry := 0;
  else
    v_retry := greatest(0, RETRY_SECONDS - floor(extract(epoch from (now() - v_last)))::int);
  end if;

  select count(*) into v_team_attempts from survival_attempts
   where game_id = p_game and player_id = any(v_team_ids) and not correct;

  return query
    select
      coalesce((select array_agg(a.player_id) from survival_answers a
                 join survival_games g on g.id = a.game_id
                where a.game_id = p_game and a.question_idx = g.question_idx), '{}'),
      coalesce((select array_agg(pl.player_id) from survival_pleas pl
                where pl.game_id = p_game), '{}'),
      coalesce((select array_agg(v.voter_id) from survival_votes v
                where v.game_id = p_game), '{}'),
      coalesce((select array_agg(e.player_id order by e.solve_order) from survival_escapes e
                where e.game_id = p_game), '{}'),
      v_retry,
      v_team_attempts;
end; $$;

-- ─── survival_seats: Path A can tie now too ────────────────────────────────
create or replace function public.survival_seats(p_game uuid)
returns table (
  player_id uuid, name text, seat int, path text,
  votes int, average numeric, solve_order int, contested boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  SEATS constant int := 3;
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) <> 'result' then
    raise exception 'the helicopter has not lifted yet';
  end if;

  return query
  with roster as (select * from public.survival_contenders(p_game)),

  escaped as (
    select r.*,
           rank()       over (order by r.solve_order)              as rk,
           row_number() over (order by r.solve_order, r.name)      as rn
      from roster r
     where r.solve_order is not null and not r.disqualified
  ),
  egrp as (select rk, count(*)::int as sz, min(rn) as first_rn from escaped group by rk),
  seated_a as (
    select e.*, g.sz, g.first_rn
      from escaped e join egrp g using (rk)
     where g.first_rn <= SEATS
  ),
  taken as (select coalesce(max(rn), 0)::int as n from seated_a),

  pool as (
    select r.*,
           row_number() over (order by r.votes desc, r.precise desc, r.name) as rn,
           rank()       over (order by r.votes desc, r.precise desc)          as rk
      from roster r
     where r.solve_order is null and not r.disqualified
  ),
  grp as (select rk, count(*)::int as sz, min(rn) as first_rn from pool group by rk),
  seated_b as (
    select p.*, g.sz, g.first_rn
      from pool p join grp g using (rk), taken t
     where t.n + g.first_rn <= SEATS
  )

  select a.player_id, a.name,
         (case when a.sz > 1 and a.first_rn + a.sz - 1 > SEATS then SEATS else a.rn end)::int,
         'escape'::text, a.votes, a.average, a.solve_order,
         (a.sz > 1 and a.first_rn + a.sz - 1 > SEATS)
    from seated_a a
  union all
  select b.player_id, b.name, ((select n from taken) + b.first_rn)::int, 'vote'::text,
         b.votes, b.average, null::int,
         (b.sz > 1 and (select n from taken) + b.first_rn + b.sz - 1 > SEATS)
    from seated_b b
  order by 3, 2;
end; $$;

notify pgrst, 'reload schema';
