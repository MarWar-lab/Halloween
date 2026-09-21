-- The ruthlessness trap — a second, independent reason a seat can be
-- refused, on top of the extraction code.
--
-- A move is "dark" when another named person is measurably worse off
-- because you chose it. Which options are dark is public — inferable from
-- the choice text itself, same reasoning survival_options' labels already
-- get — so it lives as a plain column on the table that already carries
-- everything else about a choice, not a second sealed table. What stays
-- private is your own running tally (shown to you alone, all night) and
-- what stays sealed entirely is the threshold and the disqualification
-- verdict, both only readable through the functions below.
--
-- The fairness invariant this migration exists to protect: an answer the
-- game picked FOR you — staying silent, or a late-join backfill — must never
-- count as a mark. Every function below that counts marks filters on
-- `auto_assigned = false`, and survival_worst_option is changed to never
-- hand out a dark move in the first place, belt and braces.
--
-- Safe to re-run.

alter table public.survival_options
  add column if not exists ruthless boolean not null default false;

-- ─── sealed helpers ─────────────────────────────────────────────────────────

/** The threshold itself is sealed — a number nobody knows is a number nobody can count up to and stop one short of. */
create or replace function public.survival_ruthless_threshold()
returns int language sql security definer immutable set search_path = public as $$
  select 5;
$$;
revoke all on function public.survival_ruthless_threshold() from public;

/**
 * How many non-auto-assigned dark picks this player has made. Called
 * directly it would hand anyone anyone's tally at any phase — exactly the
 * hole survival_odds_precise had before it was revoked — so this is
 * internal only; survival_ruthless_self and survival_ruthless are the two
 * doors in, each with its own phase gate.
 */
create or replace function public.survival_ruthless_marks(p_game uuid, p_player uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int
    from survival_answers a
    join survival_options o
      on o.question_idx = a.question_idx and o.option_index = a.option_index
   where a.game_id = p_game and a.player_id = p_player
     and a.auto_assigned = false
     and o.ruthless;
$$;
revoke all on function public.survival_ruthless_marks(uuid, uuid) from public;

create or replace function public.survival_disqualified(p_game uuid, p_player uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.survival_ruthless_marks(p_game, p_player)
         >= public.survival_ruthless_threshold();
$$;
revoke all on function public.survival_disqualified(uuid, uuid) from public;

-- ─── reading ────────────────────────────────────────────────────────────────

/** Your own tally, any time, but only counting rounds the room has actually opened — so you cannot probe a move's darkness before its reveal. */
create or replace function public.survival_ruthless_self(p_game uuid)
returns table (marks int, doomed boolean)
language plpgsql security definer stable set search_path = public as $$
declare
  v_me uuid;
  v_marks int;
begin
  v_me := public.survival_my_player(p_game);
  if v_me is null then raise exception 'not in this game'; end if;

  select count(*)::int into v_marks
    from survival_answers a
    join survival_options o
      on o.question_idx = a.question_idx and o.option_index = a.option_index
   where a.game_id = p_game and a.player_id = v_me
     and a.auto_assigned = false and o.ruthless
     and public.survival_revealed(p_game, a.question_idx);

  return query select v_marks, v_marks >= public.survival_ruthless_threshold();
end; $$;

/**
 * Everybody's, opened only at `result` — NOT at the tribunal, unlike
 * survival_standings. Deliberately narrower: opening this while the vote is
 * still live would let the room strategically avoid a disqualified
 * candidate instead of discovering the bump as a surprise once the seats
 * are decided. survival_vote does not check this for the same reason — see
 * the comment there.
 */
create or replace function public.survival_ruthless(p_game uuid)
returns table (player_id uuid, name text, marks int, disqualified boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) <> 'result' then
    raise exception 'nobody has been weighed yet';
  end if;

  return query
    select p.id, p.name,
           public.survival_ruthless_marks(p_game, p.id),
           public.survival_disqualified(p_game, p.id)
      from survival_players p
     where p.game_id = p_game
     order by p.name;
end; $$;

-- ─── defence in depth ───────────────────────────────────────────────────────

/**
 * A silent or late-arriving player must never be handed a dark move — the
 * ruthless-marks functions above already filter on auto_assigned, but this
 * makes it structural rather than resting on that filter alone. In today's
 * content a dark option is sometimes also the best-scoring one (which is
 * what makes the trap real for anyone optimising by percentage alone), so
 * `ruthless asc` has to be the FIRST sort key, ahead of survival_pct.
 */
create or replace function public.survival_worst_option(p_idx int)
returns smallint language sql security definer stable set search_path = public as $$
  select option_index from survival_options
   where question_idx = p_idx
   order by ruthless asc, survival_pct asc, option_index asc
   limit 1;
$$;

-- ─── survival_vote: one refusal — already-escaped, a public fact by the tribunal ─

create or replace function public.survival_vote(p_game uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  if public.survival_phase(p_game) <> 'tribunal' then
    raise exception 'voting is closed';
  end if;
  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;
  if p_target is null then raise exception 'a vote has to name somebody'; end if;
  if p_target = v_player then raise exception 'you cannot vote for yourself'; end if;
  if not exists (select 1 from survival_players
                  where id = p_target and game_id = p_game) then
    raise exception 'that person is not in this game';
  end if;
  if exists (select 1 from survival_escapes
              where game_id = p_game and player_id = p_target) then
    raise exception 'they are already on the helicopter';
  end if;
  -- Deliberately NOT refusing a vote for a disqualified target: see the
  -- comment on survival_ruthless above. The room finds out at survival_seats,
  -- not here.

  insert into survival_votes (game_id, voter_id, target_player_id)
  values (p_game, v_player, p_target)
  on conflict (game_id, voter_id) do update
    set target_player_id = excluded.target_player_id;
end; $$;

-- ─── privileges ─────────────────────────────────────────────────────────────

grant execute on function
  public.survival_ruthless_self(uuid),
  public.survival_ruthless(uuid)
to authenticated;

notify pgrst, 'reload schema';
