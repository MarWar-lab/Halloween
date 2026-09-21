-- Three ways onto the chopper, and a chopper sized for the room that turned up.
--
-- Two things were wrong, and they turn out to be the same thing.
--
-- 1. SEATS WAS A CONSTANT. Three, whoever showed up. Five players made the
--    tribunal trivial; twenty made it pointless, because three seats out of
--    twenty leaves seventeen people with no path to one. survival_seats_for
--    derives it from the roster instead, mirroring seatsFor in
--    src/survival/scale.ts.
--
-- 2. THE NINE MORAL ROUNDS DECIDED NOTHING. There were two win paths —
--    escapees in solve order, then the vote — and survival odds entered the
--    arithmetic at exactly one place, as a tie-break between two players on
--    equal votes. So the entire scored arc was decoration, and a room where
--    three people cracked the code skipped the tribunal altogether.
--
--    Now there are three paths, each claiming its own share: `escape` for
--    the extraction code, `record` for the best survival odds, `vote` for
--    the room. One per phase of the night, so none of the three is spare.
--
-- And one consequence of putting those together: THE CODE NOW SEATS WHOEVER
-- STATES IT, not their whole team. It cannot seat the team any more. At
-- twelve players that is three seats, and a team of four boarding together
-- takes every one of them — which is exactly the problem in (2), reached by
-- a different road. Budgeting the escape path a single seat instead just
-- marks every solving team `contested`, turning a rare "this could not be
-- split honestly" outcome into the normal case. The team still solves it
-- together: shared clue ownership, one keypad, one cooldown, one attempt
-- count. Only the walk through the door is individual, exactly as the pilot
-- states it — anyone who can state the code walks on now.
--
-- This replaces the CTE form of survival_seats with a loop. The CTE was
-- clever and correct for two paths with one tie each; three paths with
-- budgets and redistribution is not expressible in it without becoming
-- unreadable, and an unreadable twin of src/survival/net/local.ts is a twin
-- that silently stops matching. The loop below is a line-for-line mirror of
-- computeSeats() there, deliberately.
--
-- Safe to re-run.

-- ─── how many seats this room plays for ────────────────────────────────────

/**
 * Mirrors `seatsFor` in src/survival/scale.ts exactly; see the comment there
 * for why the floor is three and the ceiling is n - 2.
 *
 * Postgres `round()` on a numeric is half-away-from-zero, which is what
 * JavaScript's Math.round does for the positive values this ever sees.
 */
create or replace function public.survival_seats_for(p_players int)
returns int language sql immutable as $$
  select case
    when p_players <= 0 then 0
    else greatest(1, least(p_players - 2, greatest(3, round(p_players / 4.0)::int)))
  end;
$$;
grant execute on function public.survival_seats_for(int) to authenticated;

create or replace function public.survival_seat_count(p_game uuid)
returns int language sql security definer stable set search_path = public as $$
  select public.survival_seats_for(
    (select count(*)::int from survival_players where game_id = p_game)
  );
$$;
grant execute on function public.survival_seat_count(uuid) to authenticated;

-- ─── the code seats the person who states it ───────────────────────────────

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

  -- The seat belongs to whoever states the code, not to their whole team.
  -- See this migration's header: an escape path that seats whole teams takes
  -- the entire chopper at any realistic headcount, and budgeting it a single
  -- seat instead marks every solving team `contested`. The team still solves
  -- it together — shared clue ownership, one keypad, one cooldown, one
  -- attempt count, all of it above this line and all of it unchanged. Only
  -- the walk through the door is individual.
  v_order := 1 + (select count(*) from survival_escapes where game_id = p_game);
  insert into survival_escapes (game_id, player_id, solve_order)
  values (p_game, v_player, v_order)
  on conflict (game_id, player_id) do nothing;

  return query select true, v_order, 0;
end; $$;

-- ─── the seat algorithm, three paths deep ──────────────────────────────────

/**
 * Gated on `phase = 'result'`, same "that refusal IS the reveal" idiom as
 * survival_standings.
 *
 * Each path gets a budget — the seats split three ways, remainder to the
 * earlier paths — and then a second pass hands whatever a path could not
 * fill to the others, so a room where nobody cracked the code does not fly
 * out with empty seats for a boring reason. That redistribution is itself
 * the story the result screen tells: "nobody solved it, so the room chose
 * all five" is a sentence worth reading out.
 *
 * A group too big for the seats its path has left shares the last of them
 * and is marked `contested` — but only that path stops. Ending the whole
 * allocation there, as the two-path version did, would let one large tie
 * block the other two paths entirely.
 */
drop function if exists public.survival_seats(uuid);
create or replace function public.survival_seats(p_game uuid)
returns table (
  player_id uuid, name text, seat int, path text,
  votes int, average numeric, solve_order int, contested boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_seat_count int;
  v_seat_no    int := 0;
  v_taken      uuid[] := array[]::uuid[];
  v_paths      text[] := array['escape', 'record', 'vote'];
  v_budgets    int[];
  v_pass       int;
  v_slot       int;
  v_path       text;
  v_budget     int;
  v_spent      int;
  v_room       int;
  v_size       int;
  v_contested  boolean;
  v_head       record;
  v_group      uuid[];
  v_member     record;
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) <> 'result' then
    raise exception 'the helicopter has not lifted yet';
  end if;

  v_seat_count := public.survival_seat_count(p_game);

  -- teamSizes(seatCount, 3): the base share each, remainder to the earlier
  -- paths. Five seats is 2, 2, 1 — never 1, 1, 3.
  v_budgets := array[
    v_seat_count / 3 + (case when v_seat_count % 3 > 0 then 1 else 0 end),
    v_seat_count / 3 + (case when v_seat_count % 3 > 1 then 1 else 0 end),
    v_seat_count / 3
  ];

  -- Pass 1 spends each path's own budget. Pass 2 offers whatever is still
  -- unfilled back to the paths in the same order, so a path with nobody
  -- eligible hands its seats on rather than flying them out empty.
  for v_pass in 1..2 loop
    for v_slot in 1..3 loop
      v_path := v_paths[v_slot];
      v_budget := case when v_pass = 1 then v_budgets[v_slot] else v_seat_count - v_seat_no end;
      v_spent := 0;

      loop
        exit when v_spent >= v_budget or v_seat_no >= v_seat_count;

        -- The best remaining claimant on this path. Every path reads the
        -- same roster; only the sort differs.
        select c.* into v_head
          from public.survival_contenders(p_game) c
         where not c.disqualified
           and not (c.player_id = any(v_taken))
           and (v_path <> 'escape' or c.solve_order is not null)
         order by
           (case when v_path = 'escape' then c.solve_order end) asc nulls last,
           (case when v_path = 'record' then c.precise end) desc nulls last,
           (case when v_path = 'vote'   then c.votes   end) desc nulls last,
           (case when v_path = 'vote'   then c.precise end) desc nulls last,
           c.name
         limit 1;
        exit when not found;

        -- Everybody genuinely level with the head, on this path's own terms:
        -- a shared solve order, identical unrounded odds, or an identical
        -- vote count all the way down to the odds behind it.
        select array_agg(c.player_id order by c.name), count(*)::int
          into v_group, v_size
          from public.survival_contenders(p_game) c
         where not c.disqualified
           and not (c.player_id = any(v_taken))
           and (v_path <> 'escape' or c.solve_order is not null)
           and (
             (v_path = 'escape' and c.solve_order = v_head.solve_order)
             or (v_path = 'record' and c.precise = v_head.precise)
             or (v_path = 'vote' and c.votes = v_head.votes and c.precise = v_head.precise)
           );

        v_room := least(v_budget - v_spent, v_seat_count - v_seat_no);
        v_contested := v_size > v_room;
        if v_contested then v_seat_no := v_seat_no + v_room; end if;

        for v_member in
          select c.* from public.survival_contenders(p_game) c
           where c.player_id = any(v_group) order by c.name
        loop
          if not v_contested then v_seat_no := v_seat_no + 1; end if;
          v_taken := v_taken || v_member.player_id;
          player_id := v_member.player_id;
          name      := v_member.name;
          seat      := v_seat_no;
          path      := v_path;
          votes     := v_member.votes;
          average   := v_member.average;
          solve_order := case when v_path = 'escape' then v_member.solve_order else null end;
          contested := v_contested;
          return next;
        end loop;

        -- Only this path stops. Ending the whole allocation here, as the
        -- two-path version did, would let one large tie block the others.
        exit when v_contested;
        v_spent := v_spent + v_size;
      end loop;
    end loop;
  end loop;
end; $$;
grant execute on function public.survival_seats(uuid) to authenticated;

notify pgrst, 'reload schema';
