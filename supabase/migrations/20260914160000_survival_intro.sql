-- Two warm-up questions before the gauntlet, and why they need almost nothing.
--
-- The warm-ups carry no percentage and never will: there is no matching
-- footage-grade content for them and, more to the point, Mario asked for them
-- to be pure icebreakers with zero stakes. That single choice is what keeps
-- this migration small. A warm-up needs none of the sealed machinery — no
-- survival_options row, no survival_scores row, nothing to hide — so it slots
-- in as a NEGATIVE question_idx (-2, -1) ahead of the seven real questions
-- (0-6), which are untouched: no renumbering, no reseed, no risk to the 35
-- rows and the seven questions already live.
--
-- survival_scores and survival_options keep their `between 0 and 6` CHECK
-- UNCHANGED. That is deliberate and load-bearing: it means the database
-- itself refuses to ever attach a percentage to a warm-up, the same
-- "structural, not a habit" principle the rest of this schema already
-- follows for the seal. Only survival_games and survival_answers widen, to
-- admit a negative question_idx at all.
--
-- Safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_games_question_idx_check'
       and pg_get_constraintdef(oid) like '%-2%'
  ) then
    alter table public.survival_games
      drop constraint if exists survival_games_question_idx_check;
    alter table public.survival_games
      add constraint survival_games_question_idx_check
      check (question_idx between -2 and 6);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_answers_question_idx_check'
       and pg_get_constraintdef(oid) like '%-2%'
  ) then
    alter table public.survival_answers
      drop constraint if exists survival_answers_question_idx_check;
    alter table public.survival_answers
      add constraint survival_answers_question_idx_check
      check (question_idx between -2 and 6);
  end if;
end $$;

-- ─── survival_advance: start at the first warm-up, not question 0 ──────────
--
-- Only the briefing→running transition changes. The running-phase branch
-- ("< 6, then increment; otherwise → plea") is untouched on purpose: it
-- already counts -2 → -1 → 0 → … → 6 correctly, because every one of those
-- values is < 6 until the very last step.

create or replace function public.survival_advance(p_game uuid)
returns public.survival_games language plpgsql security definer set search_path = public as $$
declare v_game survival_games;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;

  if v_game.phase = 'lobby' then
    update survival_games set phase = 'briefing' where id = p_game;
  elsif v_game.phase = 'briefing' then
    update survival_games set phase = 'running', question_idx = -2, revealed = false
     where id = p_game;
  elsif v_game.phase = 'running' then
    -- Moving on without revealing would strand the question sealed forever and
    -- leave the room with a gap in the story, so it is refused rather than
    -- silently tidied up.
    if not v_game.revealed then raise exception 'reveal this one first'; end if;
    if v_game.question_idx < 6 then
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

-- ─── survival_reveal: the two gauntlet-only side effects, gated ───────────
--
-- A warm-up still gets `revealed = true` unconditionally — the UI has to
-- unlock either way — but never gets a silent player auto-assigned a "worst
-- move" (there is no worst move; nothing was ever at stake) and never writes
-- a survival_scores row (there is no percentage to write). Everything else in
-- this function is unchanged from the original.

create or replace function public.survival_reveal(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game survival_games;
  r record;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;
  if v_game.phase <> 'running' then raise exception 'nothing to reveal right now'; end if;
  if v_game.revealed then return; end if;

  if v_game.question_idx >= 0 then
    for r in
      select p.id from survival_players p
       where p.game_id = p_game
         and not exists (select 1 from survival_answers a
                          where a.game_id = p_game and a.player_id = p.id
                            and a.question_idx = v_game.question_idx)
    loop
      perform public.survival_assign(
        p_game, r.id, v_game.question_idx,
        public.survival_worst_option(v_game.question_idx), true);
    end loop;

    insert into survival_scores (game_id, player_id, question_idx, survival_pct)
    select a.game_id, a.player_id, a.question_idx, o.survival_pct
      from survival_answers a
      join survival_options o
        on o.question_idx = a.question_idx and o.option_index = a.option_index
     where a.game_id = p_game and a.question_idx = v_game.question_idx
    on conflict (game_id, player_id, question_idx) do nothing;
  end if;

  update survival_games set revealed = true where id = p_game;
end; $$;
