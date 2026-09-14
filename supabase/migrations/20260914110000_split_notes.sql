-- Say why a split paid what it paid.
--
-- The points are unchanged. Previously only the players who took the bonus got
-- a note, so a unanimous room saw a flat "+1" with no reason — indistinguishable
-- from losing, while a dead heat on the same card pays everyone 3. A playtest
-- turned up a 6-0 split where every player scored 1 and nobody could tell why.
--
-- Mirrors scoreSplit in src/game/scoring.ts. Replacing a function body only:
-- no constraint is touched, so this is safe to re-run over live data.

create or replace function public.score_split(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_points jsonb := '{}'::jsonb;
  v_notes  jsonb := '{}'::jsonb;
  v_a int; v_b int; v_small int; v_drawn boolean; v_unanimous boolean;
  r record;
begin
  select count(*) filter (where option_index = 0),
         count(*) filter (where option_index = 1)
    into v_a, v_b
    from votes where round_id = p_round and option_index is not null;

  if v_a + v_b = 0 then
    return jsonb_build_object('points', v_points, 'notes', v_notes);
  end if;

  v_drawn := v_a = v_b;
  v_unanimous := v_a = 0 or v_b = 0;
  v_small := case when v_a < v_b then 0 else 1 end;

  for r in
    select voter_id, option_index from votes
     where round_id = p_round and option_index is not null
  loop
    if v_drawn or r.option_index = v_small then
      v_points := v_points || jsonb_build_object(r.voter_id::text, 3);
      v_notes := v_notes || jsonb_build_object(
        r.voter_id::text, case when v_drawn then 'split down the middle' else 'with the few' end);
    else
      v_points := v_points || jsonb_build_object(r.voter_id::text, 1);
      v_notes := v_notes || jsonb_build_object(
        r.voter_id::text, case when v_unanimous then 'the whole room agreed' else 'with the many' end);
    end if;
  end loop;

  return jsonb_build_object('points', v_points, 'notes', v_notes);
end; $$;

grant execute on function public.score_split(uuid) to anon, authenticated;
