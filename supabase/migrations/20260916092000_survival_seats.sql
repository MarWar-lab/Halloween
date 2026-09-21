-- Two parallel win paths, three seats.
--
-- Path A (the race): anyone who solved the extraction code takes a seat, in
-- the order they solved it — a disqualified solver is skipped, not
-- reserved, and the seat passes to the next solver. Path B (the vote): once
-- Path A is done, whatever seats are left fill from the vote tally among
-- clean non-escapees, tied on the UNROUNDED survival odds exactly as
-- survival_winner already did before this feature existed.
--
-- survival_standings and survival_winner are NOT widened to carry any of
-- this — see the header note below for why that would break the migration
-- harness's second pass. survival_seats is a new function instead.
--
-- Safe to re-run.

/**
 * The shared, sealed ranking helper both functions below build on — votes,
 * both odds figures, solve order, marks and disqualified, all in one row per
 * player. No phase check inside, exactly like survival_odds_precise: its two
 * callers each check their own gate, and calling this directly would return
 * the whole tribunal at any phase, seal or no seal — hence the revoke.
 */
create or replace function public.survival_contenders(p_game uuid)
returns table (
  player_id uuid, name text, votes int, precise numeric, average numeric,
  solve_order int, marks int, disqualified boolean
)
language sql security definer stable set search_path = public as $$
  select p.id, p.name,
         (select count(*)::int from survival_votes v
           where v.game_id = p_game and v.target_player_id = p.id),
         coalesce(public.survival_odds_precise(p_game, p.id), 0),
         coalesce(public.survival_odds(p_game, p.id), 0),
         e.solve_order,
         public.survival_ruthless_marks(p_game, p.id),
         public.survival_disqualified(p_game, p.id)
    from survival_players p
    left join survival_escapes e on e.game_id = p_game and e.player_id = p.id
   where p.game_id = p_game;
$$;
revoke all on function public.survival_contenders(uuid) from public;

/**
 * The seat algorithm. Gated on `phase = 'result'`, same "that refusal IS the
 * reveal" idiom as survival_standings and survival_winner before it.
 *
 * Path A never ties: survival_escapes_order_idx makes solve_order unique per
 * game. Only Path B can tie, and only on the seat it's fighting over — every
 * member of a tie group that fits shares consecutive seats; a group bigger
 * than the room left shares the LAST seat instead, and `contested = true`
 * marks that row so the client can render it as the room's call rather than
 * the maths'.
 */
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
    select r.*, row_number() over (order by r.solve_order) as rn
      from roster r
     where r.solve_order is not null and not r.disqualified
  ),
  seated_a as (select * from escaped where rn <= SEATS),
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

  select a.player_id, a.name, a.rn::int, 'escape'::text, a.votes, a.average, a.solve_order, false
    from seated_a a
  union all
  select b.player_id, b.name, ((select n from taken) + b.first_rn)::int, 'vote'::text,
         b.votes, b.average, null::int,
         (b.sz > 1 and (select n from taken) + b.first_rn + b.sz - 1 > SEATS)
    from seated_b b
  order by 3, 2;
end; $$;

grant execute on function public.survival_seats(uuid) to authenticated;

/**
 * survival_winner keeps its exact 4-column signature (player_id, name,
 * votes, average) — widening it would break the migration harness's second
 * pass, because it is NOT preceded by a `drop function` anywhere (unlike
 * survival_progress, which is). Only its body narrows: the pool it ranks now
 * excludes anyone already escaped (the vote isn't about them) and anyone
 * disqualified (the pilot will not take them). The tie-break stays on the
 * unrounded figure, unchanged — the existing "Ping vs Pong" regression test
 * has no escapes and no dark picks in its fixture, so both new predicates
 * are no-ops on it and that invariant stays proven.
 */
create or replace function public.survival_winner(p_game uuid)
returns table (player_id uuid, name text, votes int, average numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) <> 'result' then
    raise exception 'the room has not finished voting';
  end if;

  return query
  with standing as (
    select c.player_id as id, c.name, c.votes, c.precise, c.average
      from public.survival_contenders(p_game) c
     where c.solve_order is null
       and not c.disqualified
  )
  select s.id, s.name, s.votes, s.average
    from standing s
   where s.votes = (select max(t.votes) from standing t)
     and s.precise = (select max(t.precise) from standing t
                       where t.votes = (select max(u.votes) from standing u));
end; $$;

notify pgrst, 'reload schema';
