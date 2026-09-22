-- A facilitator's escape hatch for the ruthlessness mechanic.
--
-- Marks and disqualification are the sharpest mechanic in the game and stay
-- built exactly as they are — this migration does not touch how a mark is
-- counted. It adds one lobby-only, host-only switch beside `mode`: a
-- facilitator who knows their room can turn the cutoff off before the
-- briefing opens, the same way they can switch consensus off for solo play.
--
-- Turning it off never hides a mark. survival_ruthless still reports the
-- real tally, so the debrief and the board can still name who took the most
-- dark options — it only stops that tally from costing anyone a seat.
--
-- Safe to re-run.

alter table public.survival_games
  add column if not exists ruthless_enabled boolean not null default true;

create or replace function public.survival_set_ruthless_enabled(p_game uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;
  if (select phase from survival_games where id = p_game) <> 'lobby' then
    raise exception 'too late to change that now';
  end if;
  update survival_games set ruthless_enabled = p_enabled where id = p_game;
end; $$;

grant execute on function public.survival_set_ruthless_enabled(uuid, boolean) to authenticated;

-- ─── gate the verdict itself, not just the marks tally ─────────────────────

create or replace function public.survival_disqualified(p_game uuid, p_player uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select (select ruthless_enabled from survival_games where id = p_game)
     and public.survival_ruthless_marks(p_game, p_player)
         >= public.survival_ruthless_threshold();
$$;
