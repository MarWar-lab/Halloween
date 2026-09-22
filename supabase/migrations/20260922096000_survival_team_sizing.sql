-- Teams of 3-4, not pairs.
--
-- survival_assign_teams has drawn fixed pairs (v_n / 2 teams, two apiece,
-- the odd one folded into the last team) since the day teams shipped —
-- BRIEFING.md and src/survival/scale.ts both describe "threes and fours,
-- never fewer than two teams" as the actual design, and scale.ts's
-- teamsFor/teamSizes have been built, tested and used elsewhere (splitting
-- seats across the three paths) since 20260922090000_survival_scale.sql,
-- but nothing ever re-pointed team drawing itself at them. A 20-player
-- room has been getting ten pairs instead of six teams of 3-4 the whole
-- time — a pair is two people taking turns, not the smallest group where
-- someone can go quiet for a minute and the conversation still happens
-- without them, which is the entire reason teams exist here.
--
-- This is a same-shape replace of survival_assign_teams: the team count and
-- each team's size now follow the same formula src/survival/scale.ts's
-- teamsFor/teamSizes use (mirrored below, not called — SQL has no way to
-- import a TS module), with the remainder spread across the leading teams
-- rather than dumped on the last one. Nothing about seer assignment changes.
--
-- Safe to re-run.

create or replace function public.survival_assign_teams(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_n int;
  v_teams int;
  v_base int;
  v_remainder int;
  v_size int;
  v_offset int := 0;
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

  -- teamsFor(n): max(1, min(floor(n/2), max(2, round(n/3.5)))) — never
  -- fewer than two teams once there are four people, never more than half
  -- the room, otherwise aiming for three or four per team.
  v_teams := greatest(1, least(v_n / 2, greatest(2, round(v_n / 3.5)::int)));

  -- teamSizes(n, teamCount): base = floor(n/teamCount), and the remainder
  -- goes to the FIRST teams, one each, not all onto the last one.
  v_base := v_n / v_teams;
  v_remainder := v_n % v_teams;

  for t in 0 .. v_teams - 1 loop
    v_size := v_base + (case when t < v_remainder then 1 else 0 end);
    v_start := v_offset;
    v_end := v_offset + v_size;
    for i in v_start + 1 .. v_end loop
      insert into survival_team_members (game_id, team_no, player_id)
      values (p_game, t + 1, v_ids[i]);
    end loop;
    v_offset := v_end;

    select array_agg(player_id) into v_team_ids
      from survival_team_members where game_id = p_game and team_no = t + 1;

    foreach q in array clued loop
      insert into survival_clue_seers (game_id, team_no, question_idx, player_id)
      values (p_game, t + 1, q, v_team_ids[1 + floor(random() * array_length(v_team_ids, 1))::int])
      on conflict (game_id, team_no, question_idx) do nothing;
    end loop;
  end loop;
end; $$;
