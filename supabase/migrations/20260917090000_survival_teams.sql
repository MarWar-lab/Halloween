-- Consensus mode — small teams who answer together instead of alone.
--
-- Solo is still the default and untouched: a game's `mode` column is
-- 'solo' unless the host flips it, in the lobby, before the briefing opens.
-- Consensus mode changes exactly one thing about how the night plays: when
-- a question is open, ANY member of a team can tap a move, and that tap is
-- written for every member of the team at once — one shared choice, same as
-- if each of them had tapped it themselves. Nothing downstream (scoring,
-- reveal tallies, marks, standings, seats, the extraction code) has to know
-- this happened; it all still reads survival_answers/survival_scores exactly
-- as before, one row per player per question.
--
-- Teams are drawn once, from whoever is in the lobby the moment the briefing
-- starts: pairs, in join order, with the odd one out folded into the LAST
-- team as a trio rather than left standing alone. Never reshuffled after —
-- a late joiner in consensus mode simply has no team and plays that round
-- solo, exactly like `survival_answer` already treats a teamless player.
--
-- Safe to re-run.

alter table public.survival_games
  add column if not exists mode text not null default 'solo';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'survival_games_mode_check'
  ) then
    alter table public.survival_games
      add constraint survival_games_mode_check check (mode in ('solo', 'consensus'));
  end if;
end $$;

-- Team membership is not a secret — everybody in a game can already see
-- everybody else's name and, once revealed, their answers too. So this reads
-- like survival_players: select gated on membership in the game, nothing
-- narrower, and nothing writes it except the security-definer function below.
create table if not exists public.survival_team_members (
  game_id   uuid not null references public.survival_games(id) on delete cascade,
  team_no   int not null check (team_no >= 1),
  player_id uuid not null references public.survival_players(id) on delete cascade,
  primary key (game_id, player_id)
);

alter table public.survival_team_members enable row level security;

drop policy if exists survival_team_members_select on public.survival_team_members;
create policy survival_team_members_select on public.survival_team_members
  for select using (public.survival_is_member(game_id));

grant select on public.survival_team_members to authenticated;

/**
 * Draw teams from the current roster, once. Idempotent: called a second time
 * (or on a re-applied migration) against a game that already has teams does
 * nothing, rather than drawing a second, conflicting set.
 */
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
begin
  if exists (select 1 from survival_team_members where game_id = p_game) then return; end if;

  select array_agg(id order by joined_at, id) into v_ids
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
  end loop;
end; $$;

-- Called only from survival_advance below — a security-definer function
-- calling another runs as the owner regardless of this grant, same as
-- survival_worst_option and survival_assign before it.
revoke all on function public.survival_assign_teams(uuid) from public;

create or replace function public.survival_set_mode(p_game uuid, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;
  if p_mode not in ('solo', 'consensus') then raise exception 'not a real mode'; end if;
  if (select phase from survival_games where id = p_game) <> 'lobby' then
    raise exception 'too late to change the mode now';
  end if;
  update survival_games set mode = p_mode where id = p_game;
end; $$;

grant execute on function public.survival_set_mode(uuid, text) to authenticated;

-- ─── survival_advance: draw teams the moment the briefing opens ───────────
create or replace function public.survival_advance(p_game uuid)
returns public.survival_games language plpgsql security definer set search_path = public as $$
declare v_game survival_games;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;

  if v_game.phase = 'lobby' then
    update survival_games set phase = 'briefing' where id = p_game;
    if v_game.mode = 'consensus' then
      perform public.survival_assign_teams(p_game);
    end if;
  elsif v_game.phase = 'briefing' then
    update survival_games set phase = 'running', question_idx = -2, revealed = false
     where id = p_game;
  elsif v_game.phase = 'running' then
    if not v_game.revealed then raise exception 'reveal this one first'; end if;
    if v_game.question_idx < 8 then
      update survival_games
         set question_idx = v_game.question_idx + 1, revealed = false
       where id = p_game;
    else
      update survival_games set phase = 'plea' where id = p_game;
    end if;
  elsif v_game.phase = 'plea' then
    update survival_games set phase = 'tribunal' where id = p_game;
  elsif v_game.phase = 'tribunal' then
    update survival_games set phase = 'result' where id = p_game;
  end if;

  select * into v_game from survival_games where id = p_game;
  return v_game;
end; $$;

-- ─── survival_answer: a team's tap fans out to every member at once ──────
create or replace function public.survival_answer(p_game uuid, p_option int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game survival_games;
  v_player uuid;
  v_team int;
  r record;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if v_game.phase <> 'running' then raise exception 'nothing to answer right now'; end if;
  if v_game.revealed then raise exception 'that question is already open'; end if;

  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;

  if p_option is null or p_option < 0 or p_option > 4 then
    raise exception 'that is not one of the five moves';
  end if;

  if exists (select 1 from survival_answers
              where game_id = p_game and player_id = v_player
                and question_idx = v_game.question_idx) then
    raise exception 'you have already chosen';
  end if;

  if v_game.mode = 'consensus' then
    select team_no into v_team from survival_team_members
     where game_id = p_game and player_id = v_player;
  end if;

  if v_team is not null then
    for r in
      select player_id from survival_team_members
       where game_id = p_game and team_no = v_team
    loop
      perform public.survival_assign(p_game, r.player_id, v_game.question_idx, p_option, false);
    end loop;
  else
    perform public.survival_assign(p_game, v_player, v_game.question_idx, p_option, false);
  end if;
end; $$;

notify pgrst, 'reload schema';
