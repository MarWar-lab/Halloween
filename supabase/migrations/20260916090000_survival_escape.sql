-- The extraction code — a real escape-room meta-puzzle, not another poll.
--
-- Nine rounds, seven of which carry one line of "manifest": a berth (a fixed
-- position, 1 to 4) and a seal (a random digit, 0-9), plus a verdict — signed
-- green (it counts toward the code) or red, rejected (a decoy). WHICH rounds
-- are green, red, or carry nothing at all is fixed content (src/survival/
-- questions.ts), identical every game, and not a secret — a player who reads
-- the setup text already knows it. The one thing that is random per game, and
-- genuinely sealed, is the SEVEN DIGITS themselves: one per clued round.
--
-- Delivery is the whole trick. A clue is visible only while its round is the
-- one currently in front of the room (`survival_current`) — gone the instant
-- the host advances, same as the rest of this schema treats "may I see this
-- yet?" as a phase question rather than a permanent one. Reconstructing the
-- code means having written the digits down when they were on screen, which
-- is the puzzle; nothing in this schema builds a notebook for a player who
-- didn't.
--
-- The assembled code itself follows `survival_options`' fully-sealed shape:
-- RLS on, no policy, no grant, reachable only through two narrow functions
-- that never hand the raw string to a client except at the one moment the
-- game is over (`survival_key_reveal`, gated on `phase = 'result'`, same
-- "that refusal IS the reveal" idiom `survival_standings` already uses).
--
-- Safe to re-run.

-- ─── tables ─────────────────────────────────────────────────────────────────

-- One digit per clued round, per game. Real questions only (0..8) — a
-- warm-up carries a clue exactly as often as it carries a percentage: never,
-- structurally, by the same CHECK constraint shape survival_scores already
-- uses for the same reason.
create table if not exists public.survival_clue_digits (
  game_id      uuid not null references public.survival_games(id) on delete cascade,
  question_idx int not null check (question_idx between 0 and 8),
  digit        smallint not null check (digit between 0 and 9),
  primary key (game_id, question_idx)
);

-- THE SEAL. No policy, no grant — the survival_options pattern, for the same
-- reason: two gates closed is better than one for the only string in this
-- migration that must never reach a browser before the night is over.
create table if not exists public.survival_keys (
  game_id    uuid primary key references public.survival_games(id) on delete cascade,
  code       text not null check (char_length(code) = 4),
  recipe     text not null,
  created_at timestamptz not null default now()
);

-- The rate-limit log. RLS opens a row to nobody but the player who made it —
-- not even at `result` — because a correct row here IS the code in plaintext.
-- The epilogue comes from survival_key_reveal, on purpose, never from this
-- table opening.
create table if not exists public.survival_attempts (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.survival_games(id) on delete cascade,
  player_id  uuid not null references public.survival_players(id) on delete cascade,
  attempt    text not null check (char_length(attempt) between 1 and 32),
  correct    boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists survival_attempts_player_idx
  on public.survival_attempts (game_id, player_id, created_at);

-- The race. No `seat` column here on purpose: a player can solve early and
-- still be refused a seat later (see the ruthlessness migration), so seat
-- allocation is policy computed at read time, and this table is only ever
-- the fact of who solved it and in what order. Carries no secret — the race
-- is only dramatic if it is visible — so RLS opens it to any member always.
--
-- solve_order is NOT unique per game (see the team-puzzle migration): a team
-- that escapes together shares one batch number across every member, so two
-- rows can legitimately carry the same value.
create table if not exists public.survival_escapes (
  game_id     uuid not null references public.survival_games(id) on delete cascade,
  player_id   uuid not null references public.survival_players(id) on delete cascade,
  solve_order int  not null check (solve_order >= 1),
  created_at  timestamptz not null default now(),
  primary key (game_id, player_id)
);

-- ─── helper ─────────────────────────────────────────────────────────────────

/** Is question p_idx the one actually in front of the room right now? Every clue's visibility runs through this — narrower than survival_revealed on purpose. */
create or replace function public.survival_current(p_game uuid, p_idx int)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from survival_games g
     where g.id = p_game and g.phase = 'running' and g.question_idx = p_idx
  );
$$;

-- ─── row level security ─────────────────────────────────────────────────────

alter table public.survival_clue_digits enable row level security;
alter table public.survival_keys        enable row level security;
alter table public.survival_attempts    enable row level security;
alter table public.survival_escapes     enable row level security;

drop policy if exists survival_clue_digits_read on public.survival_clue_digits;
create policy survival_clue_digits_read on public.survival_clue_digits
  for select to authenticated using (
    public.survival_is_member(game_id)
    and public.survival_current(game_id, question_idx)
  );

-- survival_keys gets NO policy. See the header. Reachable only through
-- survival_escape (compares, never returns it) and survival_key_reveal
-- (returns it, gated on the result phase).

drop policy if exists survival_attempts_read on public.survival_attempts;
create policy survival_attempts_read on public.survival_attempts
  for select to authenticated using (player_id = public.survival_my_player(game_id));

drop policy if exists survival_escapes_read on public.survival_escapes;
create policy survival_escapes_read on public.survival_escapes
  for select to authenticated using (public.survival_is_member(game_id));

-- No INSERT/UPDATE/DELETE policy on any of the four, same as everywhere else
-- in this schema: every write happens inside a security-definer RPC below.

-- ─── the generator ──────────────────────────────────────────────────────────

/**
 * Draw this game's seven digits and assemble its code, once, the moment the
 * game is created. Idempotent (both inserts are on-conflict-do-nothing) so
 * re-running it — including the live-game backfill below — never reshuffles
 * an already-dealt hand.
 *
 * The clued-round list and the berth→question mapping are fixed content,
 * identical to src/survival/questions.ts's `manifest` metadata — mirrored
 * here rather than read from anywhere, the same relationship the seed below
 * has with src/survival/sealed.ts, except there is no plaintext code on the
 * TypeScript side at all for this test to cross-check: the code exists only
 * as these seven digits, generated fresh, in this table, for this game.
 */
create or replace function public.survival_generate_key(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  clued constant int[] := array[0, 1, 3, 4, 5, 6, 8];
  q int;
  d1 int; d2 int; d3 int; d4 int;
  v_code text;
begin
  if exists (select 1 from survival_keys where game_id = p_game) then return; end if;

  foreach q in array clued loop
    insert into survival_clue_digits (game_id, question_idx, digit)
    values (p_game, q, floor(random() * 10)::int)
    on conflict (game_id, question_idx) do nothing;
  end loop;

  -- Berth 1 → The Feuding Neighbour (Q1); berth 2 → The Supply Cache (Q5);
  -- berth 3 → The Roof Breach (Q8); berth 4 → The Checkpoint (Q3).
  select digit into d1 from survival_clue_digits where game_id = p_game and question_idx = 1;
  select digit into d2 from survival_clue_digits where game_id = p_game and question_idx = 5;
  select digit into d3 from survival_clue_digits where game_id = p_game and question_idx = 8;
  select digit into d4 from survival_clue_digits where game_id = p_game and question_idx = 3;

  -- Read from the last berth back to the first: 4, 3, 2, 1.
  v_code := d4::text || d3::text || d2::text || d1::text;

  insert into survival_keys (game_id, code, recipe)
  values (
    p_game, v_code,
    format('Berth 4 down to berth 1: %s, %s, %s, %s.', d4, d3, d2, d1)
  )
  on conflict (game_id) do nothing;
end; $$;

revoke all on function public.survival_generate_key(uuid) from public;

-- ─── playing ────────────────────────────────────────────────────────────────

/**
 * Try the extraction code. Returns whether it was accepted and, if not, how
 * many seconds until the same player may try again — never a per-digit
 * hint, and never a hard cap on how many times they may try. A wrong guess
 * is recorded and returns a row rather than raising, because raising would
 * roll back the very insert the cooldown is read from on the next attempt.
 *
 * A disqualified player (see the ruthlessness migration) is allowed to
 * submit and solve exactly like anyone else — refusing them here would leak
 * their sealed disqualification mid-game. survival_seats is what quietly
 * skips them afterward.
 */
create or replace function public.survival_escape(p_game uuid, p_attempt text)
returns table (correct boolean, solve_order int, retry_in_seconds int)
language plpgsql security definer set search_path = public as $$
declare
  RETRY_SECONDS constant int := 5;
  v_game survival_games;
  v_player uuid;
  v_norm text;
  v_expected text;
  v_last timestamptz;
  v_correct boolean;
  v_order int;
begin
  -- The row lock is what makes solve-order allocation honest across two
  -- phones submitting in the same instant.
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

  v_norm := regexp_replace(coalesce(p_attempt, ''), '[^0-9]', '', 'g');
  if v_norm = '' then raise exception 'type something'; end if;

  select max(created_at) into v_last from survival_attempts
   where game_id = p_game and player_id = v_player and not survival_attempts.correct;
  if v_last is not null and v_last > now() - make_interval(secs => RETRY_SECONDS) then
    -- The client should already be disabling the button for this window;
    -- this refusal is belt-and-suspenders and records nothing new.
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

  insert into survival_escapes (game_id, player_id, solve_order)
  values (p_game, v_player, 1 + (select count(*) from survival_escapes where game_id = p_game))
  returning survival_escapes.solve_order into v_order;

  return query select true, v_order, 0;
end; $$;

-- ─── reading ────────────────────────────────────────────────────────────────

/** The epilogue. Refuses before `result`, and that refusal IS the seal — same idiom as survival_standings. */
create or replace function public.survival_key_reveal(p_game uuid)
returns table (code text, recipe text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.survival_is_member(p_game) then raise exception 'not in this game'; end if;
  if public.survival_phase(p_game) <> 'result' then
    raise exception 'the code is still the code';
  end if;
  return query select k.code, k.recipe from survival_keys k where k.game_id = p_game;
end; $$;

/**
 * Widened from three arrays to five columns. Safe across both PGlite passes
 * of the migration set: this function, uniquely among the ones this feature
 * touches, is already preceded by a `drop function` in the original
 * migration — see the header note in the next two migrations for the
 * functions that are NOT safe to widen this way.
 *
 * `retry_in_seconds` is the CALLER's own countdown, computed from their own
 * (never anyone else's) wrong attempts — folded in here so the client's
 * regular snapshot refresh gets it for free, no extra round trip.
 */
drop function if exists public.survival_progress(uuid);
create or replace function public.survival_progress(p_game uuid)
returns table (answered uuid[], pleaded uuid[], voted uuid[], escaped uuid[], retry_in_seconds int)
language plpgsql security definer stable set search_path = public as $$
declare
  RETRY_SECONDS constant int := 5;
  v_me uuid;
  v_last timestamptz;
  v_retry int;
begin
  if not public.survival_is_member(p_game) then return; end if;

  v_me := public.survival_my_player(p_game);
  select max(created_at) into v_last from survival_attempts
   where game_id = p_game and player_id = v_me and not correct;
  if v_last is null then
    v_retry := 0;
  else
    v_retry := greatest(0, RETRY_SECONDS - floor(extract(epoch from (now() - v_last)))::int);
  end if;

  return query
    select
      coalesce((select array_agg(a.player_id) from survival_answers a
                 join survival_games g on g.id = a.game_id
                where a.game_id = p_game and a.question_idx = g.question_idx), '{}'),
      coalesce((select array_agg(pl.player_id) from survival_pleas pl
                where pl.game_id = p_game), '{}'),
      coalesce((select array_agg(v.voter_id) from survival_votes v
                where v.game_id = p_game), '{}'),
      coalesce((select array_agg(e.player_id order by e.solve_order) from survival_escapes e
                where e.game_id = p_game), '{}'),
      v_retry;
end; $$;

-- ─── survival_create: generate the puzzle the moment the room exists ───────

create or replace function public.survival_create(p_name text)
returns public.survival_games language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_game survival_games;
  i int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  for attempt in 1..20 loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into survival_games (code, host_user_id)
      values (v_code, auth.uid())
      returning * into v_game;

      insert into survival_players (game_id, user_id, name)
      values (v_game.id, auth.uid(), left(trim(p_name), 12));

      perform public.survival_generate_key(v_game.id);

      return v_game;
    exception when unique_violation then
      null;
    end;
  end loop;

  raise exception 'could not allocate a free room code';
end; $$;

-- ─── backfill for games already in flight ──────────────────────────────────

do $$
declare g record;
begin
  for g in select id from survival_games where ended_at is null loop
    perform public.survival_generate_key(g.id);
  end loop;
end $$;

-- ─── privileges ─────────────────────────────────────────────────────────────

grant select on table
  public.survival_clue_digits,
  public.survival_attempts,
  public.survival_escapes
to authenticated;

-- survival_keys is deliberately absent — RLS on, no policy, no grant, same
-- reasoning as survival_options.

grant execute on function
  public.survival_escape(uuid, text),
  public.survival_key_reveal(uuid),
  public.survival_current(uuid, int),
  public.survival_progress(uuid)
to authenticated;

notify pgrst, 'reload schema';
