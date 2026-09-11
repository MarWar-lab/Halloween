-- ============================================================================
-- The Last Screen Standing — a second game, on its own tables.
--
-- Eight scripted questions. Seven offer five moves through an apocalypse; the
-- eighth asks you to beg a pilot for the last seat on the helicopter. Every
-- move carries a survival percentage, and the whole design rests on one rule:
--
--   YOUR PERCENTAGE IS YOURS. Nobody else learns it until the tribunal.
--
-- That is why this game does not reuse the Campfire tables. `games`, `players`
-- and `rounds` are published over Realtime, so anything stored on them is
-- streamed to every connected client — a per-player percentage there would
-- reach every other player's browser, silently, whatever the interface draws.
--
-- So the visibility rules are structural here rather than defensive:
--
--   * The PUBLIC fact (which move you took) and the PRIVATE fact (what it cost
--     you) live in two different tables. RLS opens a row, not a column, so one
--     table holding both would need a masking function that must never be
--     edited wrongly. Two tables, two policies, nothing to remember.
--
--   * Only survival_games and survival_players are published to Realtime.
--     Answers, scores, pleas and votes are fetched when a phase flips, exactly
--     as submissions and votes are in the other game.
--
--   * survival_options — the percentages and the outcome prose — has RLS on,
--     no policy, and no grant. Only the security-definer functions below ever
--     read it. GRANT and POLICY are separate gates and it is missing both.
--
-- Safe to re-run. The seed is an upsert, so editing a joke is a re-run of this
-- file rather than a new migration.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── tables ─────────────────────────────────────────────────────────────────

create table if not exists public.survival_games (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  phase        text not null default 'lobby'
               check (phase in ('lobby','briefing','running','plea','tribunal','result')),
  -- Which of the seven choice questions is in front of the room, 0-based.
  question_idx int not null default 0 check (question_idx between 0 and 6),
  -- Whether that question's outcomes are open. The host flips this, and it is
  -- what every "may I see this yet?" policy below keys on.
  revealed     boolean not null default false,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- Codes only need to be unique among games still running, so they recycle
-- between events instead of growing to six characters.
create unique index if not exists survival_games_active_code_idx
  on public.survival_games (code) where ended_at is null;

create table if not exists public.survival_players (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.survival_games(id) on delete cascade,
  user_id   uuid references auth.users(id) on delete set null,
  name      text not null check (char_length(trim(name)) between 1 and 12),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create unique index if not exists survival_players_one_seat_idx
  on public.survival_players (game_id, user_id) where user_id is not null;
create index if not exists survival_players_game_idx
  on public.survival_players (game_id);

-- The public half: which move you took. Opens to the room at the reveal,
-- because watching who chose what is the entire conversation.
create table if not exists public.survival_answers (
  game_id       uuid not null references public.survival_games(id) on delete cascade,
  player_id     uuid not null references public.survival_players(id) on delete cascade,
  question_idx  int not null check (question_idx between 0 and 6),
  option_index  smallint not null check (option_index between 0 and 4),
  -- True when the game chose for you: you went quiet, or you joined late.
  -- Surfaced on the player's own screen, because a bad average with no
  -- explanation reads as a bug rather than as the game.
  auto_assigned boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (game_id, player_id, question_idx)
);

-- The private half: what it cost you. Never opens until the tribunal.
--
-- Separate from survival_answers on purpose. These two facts have different
-- audiences and different moments, and a policy is a far better place to say
-- that than a function that has to remember to drop a column.
create table if not exists public.survival_scores (
  game_id      uuid not null references public.survival_games(id) on delete cascade,
  player_id    uuid not null references public.survival_players(id) on delete cascade,
  question_idx int not null check (question_idx between 0 and 6),
  survival_pct smallint not null check (survival_pct between 0 and 100),
  primary key (game_id, player_id, question_idx)
);

create table if not exists public.survival_pleas (
  game_id    uuid not null references public.survival_games(id) on delete cascade,
  player_id  uuid not null references public.survival_players(id) on delete cascade,
  text       text not null check (char_length(trim(text)) between 1 and 150),
  created_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table if not exists public.survival_votes (
  game_id          uuid not null references public.survival_games(id) on delete cascade,
  voter_id         uuid not null references public.survival_players(id) on delete cascade,
  target_player_id uuid not null references public.survival_players(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (game_id, voter_id)
);

-- THE SEAL. No policy, no grant — see the header. If you are about to add
-- either, the game you are changing is a different game.
create table if not exists public.survival_options (
  question_idx int not null check (question_idx between 0 and 6),
  option_index smallint not null check (option_index between 0 and 4),
  label        text not null,
  survival_pct smallint not null check (survival_pct between 0 and 100),
  outcome      text not null,
  primary key (question_idx, option_index)
);

-- ─── helpers (security definer so the policies below do not recurse) ────────

create or replace function public.survival_is_member(p_game uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from survival_players where game_id = p_game and user_id = auth.uid()
  ) or exists (
    select 1 from survival_games where id = p_game and host_user_id = auth.uid()
  );
$$;

create or replace function public.survival_is_host(p_game uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from survival_games where id = p_game and host_user_id = auth.uid()
  );
$$;

create or replace function public.survival_my_player(p_game uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select id from survival_players
   where game_id = p_game and user_id = auth.uid() limit 1;
$$;

create or replace function public.survival_phase(p_game uuid)
returns text language sql security definer stable set search_path = public as $$
  select phase from survival_games where id = p_game;
$$;

/**
 * Has question p_idx been opened to the room yet?
 *
 * Every "may I see this" decision about an answer runs through here, so the
 * rule lives in one place: a question is open once the host has revealed it,
 * and stays open for the rest of the night.
 */
create or replace function public.survival_revealed(p_game uuid, p_idx int)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from survival_games g
     where g.id = p_game
       and (g.phase in ('plea','tribunal','result')
            or g.question_idx > p_idx
            or (g.question_idx = p_idx and g.revealed))
  );
$$;

/** The lowest-survival move on a question — what the game picks for you. */
create or replace function public.survival_worst_option(p_idx int)
returns smallint language sql security definer stable set search_path = public as $$
  select option_index from survival_options
   where question_idx = p_idx
   order by survival_pct asc, option_index asc
   limit 1;
$$;

-- ─── row level security ─────────────────────────────────────────────────────

alter table public.survival_games   enable row level security;
alter table public.survival_players enable row level security;
alter table public.survival_answers enable row level security;
alter table public.survival_scores  enable row level security;
alter table public.survival_pleas   enable row level security;
alter table public.survival_votes   enable row level security;
alter table public.survival_options enable row level security;

-- Joining goes through survival_join, which is security definer and does not
-- need a permissive policy here. So a game row is readable only by people
-- already in it, and a stranger cannot enumerate live room codes.
drop policy if exists survival_games_read on public.survival_games;
create policy survival_games_read on public.survival_games
  for select to authenticated using (public.survival_is_member(id));

drop policy if exists survival_players_read on public.survival_players;
create policy survival_players_read on public.survival_players
  for select to authenticated using (public.survival_is_member(game_id));

-- Your own move is always yours to see. Everyone else's opens at the reveal,
-- names attached — that is the round's payoff, not a leak.
drop policy if exists survival_answers_read on public.survival_answers;
create policy survival_answers_read on public.survival_answers
  for select to authenticated using (
    player_id = public.survival_my_player(game_id)
    or (
      public.survival_is_member(game_id)
      and public.survival_revealed(game_id, question_idx)
    )
  );

-- THE POLICY THE GAME RESTS ON. Your percentage is yours alone, all the way
-- to the tribunal — where every number opens at once and the argument starts.
--
-- Note there is no reveal clause here. A revealed question opens what people
-- CHOSE, never what it cost them.
drop policy if exists survival_scores_read on public.survival_scores;
create policy survival_scores_read on public.survival_scores
  for select to authenticated using (
    player_id = public.survival_my_player(game_id)
    or (
      public.survival_is_member(game_id)
      and public.survival_phase(game_id) in ('tribunal','result')
    )
  );

-- Pleas are sealed while they are being written, so nobody writes theirs
-- against somebody else's. They open attributed, because the tribunal is a
-- judgement of a named person and an anonymous one would be pointless.
drop policy if exists survival_pleas_read on public.survival_pleas;
create policy survival_pleas_read on public.survival_pleas
  for select to authenticated using (
    player_id = public.survival_my_player(game_id)
    or (
      public.survival_is_member(game_id)
      and public.survival_phase(game_id) in ('tribunal','result')
    )
  );

-- Votes stay sealed until the result, so no tally builds up in public and
-- nobody piles onto whoever is already ahead.
drop policy if exists survival_votes_read on public.survival_votes;
create policy survival_votes_read on public.survival_votes
  for select to authenticated using (
    voter_id = public.survival_my_player(game_id)
    or (
      public.survival_is_member(game_id)
      and public.survival_phase(game_id) = 'result'
    )
  );

-- survival_options gets NO policy. See the header. It is reachable only
-- through the security-definer functions below, which run as the owner.

-- No INSERT/UPDATE/DELETE policies anywhere, deliberately: every write happens
-- inside a security-definer RPC, so nobody can set their own percentage.

-- ─── RPCs: lifecycle ────────────────────────────────────────────────────────

/**
 * Record a move. Never writes a percentage — scores are not computed until the
 * host reveals, so a player cannot learn what their own tap was worth by
 * watching their own row appear.
 *
 * `on conflict do nothing` is how "a tap is final" is enforced at the bottom
 * rather than in the interface.
 */
create or replace function public.survival_assign(p_game uuid, p_player uuid,
                                                  p_idx int, p_option int,
                                                  p_auto boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
  values (p_game, p_player, p_idx, p_option, p_auto)
  on conflict (game_id, player_id, question_idx) do nothing;
end; $$;

create or replace function public.survival_create(p_name text)
returns public.survival_games language plpgsql security definer set search_path = public as $$
declare
  -- No O/0/I/1: these get read aloud over a video call and misheard.
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

      return v_game;
    exception when unique_violation then
      -- Code collided with a live game; try another.
      null;
    end;
  end loop;

  raise exception 'could not allocate a free room code';
end; $$;

/**
 * Take a seat.
 *
 * Rejoining after a refresh keeps the seat you already had. Arriving late is
 * different: every question the room has already been through is backfilled
 * with the worst move on it, so that the one rule the rest of this schema
 * depends on holds without exception —
 *
 *   every player has an answer for every revealed question.
 *
 * No gaps means the average has the same denominator for everybody and never
 * needs an asterisk. It also means somebody who joins at question five is out
 * of contention, which is the intended cost of turning up late to an
 * apocalypse everyone else is already in.
 */
create or replace function public.survival_join(p_code text, p_name text)
returns public.survival_players language plpgsql security definer set search_path = public as $$
declare
  v_game survival_games;
  v_player survival_players;
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
  end if;

  for q in 0..6 loop
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

create or replace function public.survival_resolve_code(p_code text)
returns uuid language sql security definer stable set search_path = public as $$
  select id from survival_games
   where code = upper(trim(p_code)) and ended_at is null limit 1;
$$;

create or replace function public.survival_resume(p_game uuid)
returns table (player_id uuid, is_host boolean)
language sql security definer stable set search_path = public as $$
  select public.survival_my_player(p_game), public.survival_is_host(p_game);
$$;

create or replace function public.survival_heartbeat(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update survival_players set last_seen = now()
   where game_id = p_game and user_id = auth.uid();
end; $$;

-- ─── RPCs: playing ──────────────────────────────────────────────────────────

create or replace function public.survival_answer(p_game uuid, p_option int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game survival_games;
  v_player uuid;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if v_game.phase <> 'running' then raise exception 'nothing to answer right now'; end if;
  if v_game.revealed then raise exception 'that question is already open'; end if;

  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;

  if p_option is null or p_option < 0 or p_option > 4 then
    raise exception 'that is not one of the five moves';
  end if;

  if exists (select 1 from survival_answers
              where game_id = p_game and player_id = v_player
                and question_idx = v_game.question_idx) then
    raise exception 'you have already chosen';
  end if;

  perform public.survival_assign(p_game, v_player, v_game.question_idx, p_option, false);
end; $$;

/**
 * Open the current question.
 *
 * Anyone who has not answered is given the worst move on it — the game does
 * not wait for a phone that has gone quiet, and there is no timer to do this
 * job instead. Then, and only then, the percentages are looked up and written.
 *
 * This is the ONE place survival_options is read on a normal path, and the one
 * place a percentage enters the game. Keeping it here is why the seal is a
 * property of the schema rather than a habit.
 */
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

  update survival_games set revealed = true where id = p_game;
end; $$;

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
    update survival_games set phase = 'running', question_idx = 0, revealed = false
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

create or replace function public.survival_plea(p_game uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  if public.survival_phase(p_game) <> 'plea' then
    raise exception 'the chopper is not listening right now';
  end if;
  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;

  insert into survival_pleas (game_id, player_id, text)
  values (p_game, v_player, left(trim(p_text), 150))
  on conflict (game_id, player_id) do update set text = excluded.text;
end; $$;

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

  insert into survival_votes (game_id, voter_id, target_player_id)
  values (p_game, v_player, p_target)
  on conflict (game_id, voter_id) do update
    set target_player_id = excluded.target_player_id;
end; $$;

-- ─── RPCs: reading ──────────────────────────────────────────────────────────

/**
 * Who has acted, and never what they did.
 *
 * The host has to know when the room has finished or the game cannot be run,
 * and the content of an answer, a plea or a vote is sealed at every one of
 * those moments. So the fact is public and the substance is not — three lists
 * of ids, no option, no text, no target. Never widen this to carry any.
 */
drop function if exists public.survival_progress(uuid);
create or replace function public.survival_progress(p_game uuid)
returns table (answered uuid[], pleaded uuid[], voted uuid[])
language sql security definer stable set search_path = public as $$
  select
    coalesce((select array_agg(a.player_id) from survival_answers a
               join survival_games g on g.id = a.game_id
              where a.game_id = p_game and a.question_idx = g.question_idx), '{}'),
    coalesce((select array_agg(pl.player_id) from survival_pleas pl
              where pl.game_id = p_game), '{}'),
    coalesce((select array_agg(v.voter_id) from survival_votes v
              where v.game_id = p_game), '{}')
  where public.survival_is_member(p_game);
$$;

/**
 * The five outcomes, once the question is open.
 *
 * There is no survival_pct column in this result and there must never be one.
 * The prose and the tally of who took what are the public payoff; the number
 * behind each move is not, and a player only ever learns the one they took.
 */
create or replace function public.survival_reveal_data(p_game uuid, p_idx int)
returns table (option_index smallint, label text, outcome text, takers int)
language sql security definer stable set search_path = public as $$
  select o.option_index,
         o.label,
         o.outcome,
         (select count(*)::int from survival_answers a
           where a.game_id = p_game and a.question_idx = p_idx
             and a.option_index = o.option_index) as takers
    from survival_options o
   where o.question_idx = p_idx
     and public.survival_is_member(p_game)
     and public.survival_revealed(p_game, p_idx)
   order by o.option_index;
$$;

/**
 * Everybody's final survival rate.
 *
 * Raises before the tribunal, and that refusal IS the reveal — it is the only
 * thing standing between a curious player and the whole leaderboard, so it is
 * a thrown exception rather than an empty result. An empty result reads like
 * "no data yet" and invites a retry loop.
 */
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
           coalesce(round(avg(s.survival_pct), 1), 0)
      from survival_players p
      left join survival_scores s on s.game_id = p.game_id and s.player_id = p.id
     where p.game_id = p_game
     group by p.id, p.name
     order by coalesce(avg(s.survival_pct), 0) desc, p.name;
end; $$;

/**
 * Who takes the seat.
 *
 * The room decides. When the room cannot, the higher survival average takes
 * it — which is the right shape for this game, because the maths everyone
 * spent eight questions hiding is exactly what settles the argument they
 * could not. Level on both and they share the helicopter: two rows come back
 * rather than a third rule nobody agreed to.
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
    select p.id,
           p.name,
           (select count(*)::int from survival_votes v
             where v.game_id = p_game and v.target_player_id = p.id) as votes,
           coalesce((select round(avg(s.survival_pct), 1) from survival_scores s
                      where s.game_id = p_game and s.player_id = p.id), 0) as average
      from survival_players p
     where p.game_id = p_game
  )
  select s.id, s.name, s.votes, s.average
    from standing s
   where s.votes = (select max(t.votes) from standing t)
     and s.average = (select max(t.average) from standing t
                       where t.votes = (select max(u.votes) from standing u));
end; $$;

-- ─── privileges ─────────────────────────────────────────────────────────────
--
-- GRANT and POLICY are separate gates and both are required; a missing grant
-- fails at 42501 before a policy is ever consulted. Only SELECT is granted,
-- and only to `authenticated` — every write goes through the definer RPCs, so
-- nobody can edit their own percentage even if a policy were wrong.

grant usage on schema public to anon, authenticated;

grant select on table
  public.survival_games,
  public.survival_players,
  public.survival_answers,
  public.survival_scores,
  public.survival_pleas,
  public.survival_votes
to authenticated;

-- survival_options is deliberately absent from that list. It has RLS on and no
-- policy, so even a grant would return nothing — but the grant is missing too,
-- because two gates are better than one for the only table that must not leak.

-- Postgres grants EXECUTE on a new function to PUBLIC by default. For these
-- two that default is a hole, not a convenience:
--
--   survival_worst_option  names the worst move on a question. Calling it
--                          before you choose would hand you the answer.
--   survival_assign        writes an answer with no authorisation check at
--                          all, because its callers have already done it.
--
-- Both are internal. Their callers are security definer and run as the owner,
-- so revoking these costs nothing and closes the one path around the seal.
revoke all on function public.survival_worst_option(int) from public;
revoke all on function public.survival_assign(uuid, uuid, int, int, boolean) from public;

grant execute on function
  public.survival_create(text),
  public.survival_join(text, text),
  public.survival_resolve_code(text),
  public.survival_resume(uuid),
  public.survival_heartbeat(uuid),
  public.survival_answer(uuid, int),
  public.survival_reveal(uuid),
  public.survival_advance(uuid),
  public.survival_plea(uuid, text),
  public.survival_vote(uuid, uuid),
  public.survival_progress(uuid),
  public.survival_reveal_data(uuid, int),
  public.survival_standings(uuid),
  public.survival_winner(uuid),
  public.survival_is_member(uuid),
  public.survival_is_host(uuid),
  public.survival_my_player(uuid),
  public.survival_phase(uuid),
  public.survival_revealed(uuid, int)
to authenticated;

-- ─── realtime ───────────────────────────────────────────────────────────────
-- Only the two tables carrying no secret are published. Answers, scores,
-- pleas and votes are fetched when a phase flips — a published row would put
-- every player's percentage in every other player's browser, with nothing in
-- the interface to show it had happened.

do $$
begin
  alter publication supabase_realtime add table public.survival_games;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.survival_players;
exception when duplicate_object then null; end $$;

-- ─── the seal itself ────────────────────────────────────────────────────────
--
-- An upsert, so editing a joke or retuning a percentage is a re-run of this
-- file rather than a new migration. It widens and never narrows: a row absent
-- from this list is left alone rather than deleted.
--
-- Mirrored by src/survival/sealed.ts, which exists only so the local backend
-- can run a game with no database. THIS TABLE IS THE AUTHORITY, and
-- src/survival/seal.test.ts fails the build if the two disagree.
--
-- Outcome prose is capped at 160 characters, asserted in that same test. Five
-- of these have to fit on a shared screen at 1366x768 without scrolling, and a
-- cap enforced by a test is the only kind that survives contact with an editor.

insert into public.survival_options (question_idx, option_index, label, survival_pct, outcome) values
  (0, 0, 'Drive downtown and get them yourself', 45,
      'Driving into an epicentre is logistical suicide. You hit gridlock, abandon the car, and barely make it out on foot.'),
  (0, 1, 'Order them a $300 surge-price Uber Black', 60,
      'The gig economy provides. The driver picks them up, then drops them two blocks short of you at a military roadblock.'),
  (0, 2, 'Block their number and barricade the door', 75,
      'Utterly ruthless. You are physically safe behind your own door. Your soul is not. You survived. At what cost?'),
  (0, 3, 'Tell them to meet you halfway at the park', 50,
      'Moving targets are unpredictable. You both survive the rendezvous, and get to know a public restroom far better than planned.'),
  (0, 4, 'Fly them a survival kit by drone', 65,
      'Smart delegation. You stay safe, but a panicked survivor downs your drone with a rock before it ever reaches them.'),

  (1, 0, 'Offer your antibiotics for a seat', 50,
      'They take the deal, and they still hate you. Trading away critical medicine on day one is a debt that comes due later.'),
  (1, 1, 'Bribe them with a 2TB drive of films', 70,
      'In an apocalypse, offline entertainment is the new gold. They take the drive gladly and let you keep your bag.'),
  (1, 2, 'Golf club to the head, take the SUV', 45,
      'You get the car. You do not get the biometric kill-switch in the steering wheel, which stalls it a mile down the road.'),
  (1, 3, 'Ditch your bag, ride beside the dog', 60,
      'A bumpy ride next to an aggressive Rottweiler earns you a deep bite on the arm that military scanners must never see.'),
  (1, 4, 'AirTag their bumper, follow on a bike', 55,
      'Bicycles need no fuel and make no noise. The AirTag needs passing iPhones, and every phone in this city is already dead.'),

  (2, 0, 'Shove a cougher into the AI scanner', 60,
      'The medical lockdown works and you slip out the side gate. The turrets almost track you. You are officially a villain.'),
  (2, 1, 'Hi-vis vest, clipboard, walk briskly', 80,
      'Social engineering remains undefeated. Nobody in the history of security has ever stopped a man carrying a clipboard.'),
  (2, 2, 'Wait in line and keep your head down', 70,
      'You clear the scanner seconds before the riot behind you breaches the perimeter. Boring, unheroic, and correct.'),
  (2, 3, 'Help the guard calm the crowd', 55,
      'Noble. The crowd turns anyway, you go under it, and the guards drag you through the gate with a broken rib.'),
  (2, 4, 'Crawl through the storm drain', 50,
      'You bypass every guard and every scanner. The toxic runoff bypasses your skin and gives you a serious infection.'),

  (3, 0, 'A dead worker''s ID on the IOTA terminal', 75,
      'The IOTA ledger logs your entry and the gate opens clean. Decentralised infrastructure does not care that the grid is down.'),
  (3, 1, 'Type admin and password into the keypad', 65,
      'It works, proving IT negligence outlasts civilisation itself. It also trips a silent alarm you will hear about later.'),
  (3, 2, 'Take the hand with you for the scanners', 50,
      'Modern scanners check blood flow and pulse. Dead tissue reads as dead tissue, the gate refuses it, and the alarms start.'),
  (3, 3, 'Slip in behind an automated cargo truck', 80,
      'Patience pays. Zero contact, zero noise, zero trace. The safest way through a locked door is to let it open for someone else.'),
  (3, 4, 'Beg port authority over the comms box', 55,
      'The AI denies your request. The shouting attracts everything nearby, and you go over razor wire in a considerable hurry.'),

  (4, 0, 'Water and high-calorie protein paste', 75,
      'Hydration and calories are the whole foundation of staying alive. Boring, unglamorous, and very difficult to argue with.'),
  (4, 1, 'The industrial CO2 fire extinguisher', 80,
      'Pragmatism wins. Sub-zero gas blinds anything in front of you, and it is a heavy metal club once the gas runs out.'),
  (4, 2, 'Nothing, and lock the door behind you', 60,
      'You escape cleanly. The screaming you leave behind draws twice as many of them onto your floor.'),
  (4, 3, 'The trauma kit, for the injured outside', 50,
      'You save a life in the hallway. Now there are two of you, with no food and no weapon, moving at half speed.'),
  (4, 4, 'A solar battery bank and a smart radio', 55,
      'Information is comforting. A radio has never once stopped a set of teeth from closing on a forearm.'),

  (5, 0, 'Trip the stranger running beside you', 25,
      'You only have to outrun them, not the horde. They grab your ankle on the way down and take you with them.'),
  (5, 1, 'Throw loose change down the stairwell', 30,
      'The clatter pulls everything below you away. It also tells everything above you exactly which floor you are on.'),
  (5, 2, 'Shoes off, climb in total silence', 20,
      'You are genuinely silent. You are also barefoot on an exposed wire and broken glass, in absolute darkness.'),
  (5, 3, 'Hold your phone light up for the group', 10,
      'You have made yourself the only bright object in a pitch-black shaft. They come to the light. All of them.'),
  (5, 4, 'Climb outside the railing, over the drop', 15,
      'Your grip fails somewhere around the twenty-second floor. You vault back over the rail alive and completely spent.'),

  (6, 0, 'Smear yourself in infected blood', 15,
      'This is not that kind of virus. It tracks thermal signature, not smell. You have given yourself sepsis for nothing.'),
  (6, 1, 'Wrap up in a silver space blanket', 30,
      'The foil scrambles their thermal read just enough. They stream straight past you toward the helipad.'),
  (6, 2, 'Push a generator against the door', 25,
      'Heavy machinery buys you a handful of breaths before the sheer mass of bodies shoves it aside.'),
  (6, 3, 'Stand at the door and hold them off', 10,
      'Fifty bodies against one. Heroic, quotable, and over before the others have finished boarding.'),
  (6, 4, 'Jam the door''s hydraulic gears', 20,
      'The gears eat your weapon without slowing down, and the door opens exactly as it was always going to.')
on conflict (question_idx, option_index) do update
  set label        = excluded.label,
      survival_pct = excluded.survival_pct,
      outcome      = excluded.outcome;

notify pgrst, 'reload schema';
