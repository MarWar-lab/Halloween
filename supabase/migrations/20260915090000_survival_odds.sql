-- Survival odds compound; they do not average.
--
-- A round's percentage is your chance of surviving THAT round alone. Still
-- being standing after several of them means having survived all of them, and
-- the chance of several independent things all going your way is their
-- product, not their mean: 75% then 70% is a 52.5% chance of both, not a
-- 72.5% chance of "one of them, on average." An arithmetic mean also cannot
-- fall as the night goes on no matter how bad the calls get, which
-- contradicts the entire premise of the game.
--
-- Mirrors survivalOddsOf / survivalOddsPrecise in src/survival/types.ts
-- exactly. Function bodies only, no schema change — safe to re-run.

/**
 * The product of every scored round for one player, as a percentage,
 * UNROUNDED. Never returned to a client directly — only compared.
 *
 * Seven compounding rounds routinely lands several players on the same
 * rounded "0.0%" (even a run of good calls compounds down to a few percent by
 * the end), and deciding a ranking or a tie-break on that shared rounded
 * figure would call a real difference a tie when it is not one. Everything
 * that DECIDES something — the standings order, the winner tie-break —
 * compares this value; only the final SELECT rounds it for a human to read.
 *
 * Plain PL/pgSQL multiplication over `numeric`, not exp(sum(ln(x))) — this is
 * a game score, not a scientific computation, and exact decimal arithmetic is
 * both simpler to read and immune to the "cannot take the log of zero" trap
 * that exp/ln hits the moment a percentage is ever seeded at 0.
 */
create or replace function public.survival_odds_precise(p_game uuid, p_player uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_product numeric := 1;
  v_rounds int := 0;
  r record;
begin
  for r in
    select survival_pct from survival_scores
     where game_id = p_game and player_id = p_player
  loop
    v_product := v_product * (r.survival_pct::numeric / 100);
    v_rounds := v_rounds + 1;
  end loop;

  if v_rounds = 0 then return null; end if;
  return v_product * 100;
end; $$;

/** The same figure, rounded — what actually reaches a screen. */
create or replace function public.survival_odds(p_game uuid, p_player uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(public.survival_odds_precise(p_game, p_player), 1);
$$;

create or replace function public.survival_standings(p_game uuid)
returns table (player_id uuid, name text, rounds int, average numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) not in ('tribunal','result') then
    raise exception 'the survival rates are still sealed';
  end if;

  return query
    select p.id,
           p.name,
           count(s.survival_pct)::int,
           coalesce(public.survival_odds(p_game, p.id), 0)
      from survival_players p
      left join survival_scores s on s.game_id = p.game_id and s.player_id = p.id
     where p.game_id = p_game
     group by p.id, p.name
     -- Ranked on the unrounded figure, displayed as the rounded one.
     order by coalesce(public.survival_odds_precise(p_game, p.id), 0) desc, p.name;
end; $$;

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
    select p.id,
           p.name,
           (select count(*)::int from survival_votes v
             where v.game_id = p_game and v.target_player_id = p.id) as votes,
           coalesce(public.survival_odds_precise(p_game, p.id), 0) as precise_odds,
           coalesce(public.survival_odds(p_game, p.id), 0) as average
      from survival_players p
     where p.game_id = p_game
  )
  select s.id, s.name, s.votes, s.average
    from standing s
   where s.votes = (select max(t.votes) from standing t)
     -- Tie-broken on the unrounded figure — two genuinely different odds can
     -- share the same rounded `average`, and that must not read as a draw.
     and s.precise_odds = (select max(t.precise_odds) from standing t
                            where t.votes = (select max(u.votes) from standing u));
end; $$;

-- Neither helper is gated on its own — no phase check, no membership check,
-- both read survival_scores directly as the owner. Only survival_standings
-- and survival_winner check the tribunal phase before ever calling them.
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and that
-- default would be a way straight around the phase gate: called directly,
-- survival_odds_precise(any_game, any_player) hands back a raw percentage
-- for anyone, at any phase, seal or no seal. Revoked, same as
-- survival_worst_option and survival_assign before them — a security-definer
-- function can still call another one internally regardless of this grant,
-- because the call runs as the function owner the whole way down.
revoke all on function public.survival_odds_precise(uuid, uuid) from public;
revoke all on function public.survival_odds(uuid, uuid) from public;

grant execute on function
  public.survival_standings(uuid),
  public.survival_winner(uuid)
to authenticated;

notify pgrst, 'reload schema';
