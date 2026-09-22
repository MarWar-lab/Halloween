-- A late joiner used to arrive teamless and hold no fragment for any berth
-- already open — a real gap, not a design choice. Once teams are drawn, a
-- teamless player is "a team of one" to every puzzle already dealt: exactly
-- the single point of failure `noTeamSolves` exists to rule out, and the
-- one arrival this game explicitly promises not to leave behind (a late
-- joiner already gets backfilled on every missed question, precisely so
-- nobody has a gap — teams and fragments were the one place that promise
-- was not kept).
--
-- Two things happen now, if teams have already been drawn for this game
-- when a brand new player joins:
--
--   1. They fold into whichever team currently has the fewest members.
--   2. They are dealt a fragment for every berth whose puzzle already
--      exists (`survival_berth_lines` has rows for it) — always a SPARE
--      rule, constructed to be true of every line on that berth's board,
--      never a KEY rule. The key rules are already placed with whoever was
--      on the team when the puzzle was dealt; moving one to the new
--      arrival would relocate it, not add to it, and could strand the
--      teammate who is expecting to still hold it.
--
-- Mirrors src/survival/net/local.ts's `spareRuleFor` exactly: a
-- `signedAfter` one minute before the earliest line on the board, true of
-- every line by construction and therefore incapable of narrowing anything.
--
-- Safe to re-run.

create or replace function public.survival_join(p_code text, p_name text)
returns public.survival_players language plpgsql security definer set search_path = public as $$
declare
  v_game survival_games;
  v_player survival_players;
  v_team_no int;
  v_berth record;
  v_earliest int;
  q int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  select * into v_game from survival_games
   where code = upper(trim(p_code)) and ended_at is null
   limit 1;
  if not found then raise exception 'no game with that code'; end if;

  select * into v_player from survival_players
   where game_id = v_game.id and user_id = auth.uid();

  if found then
    update survival_players
       set name = coalesce(nullif(left(trim(p_name), 12), ''), name),
           last_seen = now()
     where id = v_player.id
     returning * into v_player;
  else
    insert into survival_players (game_id, user_id, name)
    values (v_game.id, auth.uid(), left(trim(p_name), 12))
    returning * into v_player;

    -- Fold into the smallest team, if any have been drawn yet.
    select team_no into v_team_no
      from survival_team_members
     where game_id = v_game.id
     group by team_no
     order by count(*) asc, team_no asc
     limit 1;

    if v_team_no is not null then
      insert into survival_team_members (game_id, team_no, player_id)
      values (v_game.id, v_team_no, v_player.id)
      on conflict (game_id, player_id) do nothing;

      -- A spare fragment for every berth already open.
      for v_berth in select distinct berth from survival_berth_lines where game_id = v_game.id loop
        select min(signed_at) into v_earliest
          from survival_berth_lines where game_id = v_game.id and berth = v_berth.berth;
        insert into survival_fragments (game_id, berth, player_id, rule)
        values (
          v_game.id, v_berth.berth, v_player.id,
          jsonb_build_object('kind', 'signedAfter', 'minutes', v_earliest - 1)
        )
        on conflict (game_id, berth, player_id) do nothing;
      end loop;
    end if;
  end if;

  for q in 0..8 loop
    if public.survival_revealed(v_game.id, q) then
      perform public.survival_assign(
        v_game.id, v_player.id, q, public.survival_worst_option(q), true);
      insert into survival_scores (game_id, player_id, question_idx, survival_pct)
      select v_game.id, v_player.id, q, o.survival_pct
        from survival_answers a
        join survival_options o
          on o.question_idx = q and o.option_index = a.option_index
       where a.game_id = v_game.id and a.player_id = v_player.id and a.question_idx = q
      on conflict (game_id, player_id, question_idx) do nothing;
    end if;
  end loop;

  return v_player;
end; $$;

notify pgrst, 'reload schema';
