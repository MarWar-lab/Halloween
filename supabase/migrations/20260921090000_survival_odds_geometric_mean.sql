-- Carries the geometric-mean fix to survival_odds_precise into production.
--
-- 20260915090000_survival_odds.sql was edited in place to make this change
-- (the repo's own rule at the time: "never edit an applied migration" only
-- applies once something has actually been pushed live, and this project
-- hadn't been). It has since been pushed once already, before this fix
-- existed, so `supabase db push` will never re-run that file's body again —
-- Postgres migration tracking is by filename, not by content. Without this
-- patch, production would keep compounding nine rounds down to an
-- unreadable ~1% forever, no matter how good a run was.
--
-- Body-only, verbatim from the corrected 20260915090000_survival_odds.sql.
-- Safe to re-run.

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
  return (power(v_product::double precision, 1.0 / v_rounds) * 100)::numeric;
end; $$;

create or replace function public.survival_odds(p_game uuid, p_player uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(public.survival_odds_precise(p_game, p_player), 1);
$$;

revoke all on function public.survival_odds_precise(uuid, uuid) from public;
revoke all on function public.survival_odds(uuid, uuid) from public;

notify pgrst, 'reload schema';
