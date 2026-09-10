-- ============================================================================
-- Campfire — initial schema
--
-- Design notes, because the security model is the interesting part:
--
--  * Clients NEVER write game tables directly. Every mutation goes through a
--    `security definer` RPC that checks who is asking. That is what makes the
--    leaderboard trustworthy — you cannot edit your score from devtools.
--
--  * Sealed submissions are enforced by RLS, not by the UI hiding things. A
--    submission is invisible to everyone but its author until the round reaches
--    `revealing`. A vote is invisible until `scored`. If those policies are
--    wrong, the all-play mechanic is a lie, so they have tests.
--
--  * Timers are server-set (`deadline_at = now() + interval`). A fast laptop
--    clock cannot gift anyone extra seconds.
--
--  * Scoring is computed here, mirroring src/game/scoring.ts. If you change a
--    rule, change both. The TypeScript version exists for instant previews and
--    unit tests; this one is authoritative.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── tables ─────────────────────────────────────────────────────────────────

create table if not exists public.games (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  deck_id      text not null default 'halloween',
  theme_id     text not null default 'halloween',
  phase        text not null default 'lobby'
               check (phase in ('lobby','briefing','warmup','round1',
                                'intermission','round2','finale','awards')),
  round_no     int  not null default 0,
  heat_cap     int  not null default 1 check (heat_cap between 1 and 3),
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- Room codes only need to be unique among games still running, so codes can be
-- recycled between events instead of growing to six characters.
create unique index if not exists games_active_code_idx
  on public.games (code) where ended_at is null;

create table if not exists public.players (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null check (char_length(trim(name)) between 1 and 24),
  look          jsonb not null default '{}'::jsonb,
  is_proxy      boolean not null default false,
  controlled_by uuid references public.players(id) on delete set null,
  score         int not null default 0,
  pass_spent    boolean not null default false,
  joined_at     timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

-- One seat per person per game. Proxies have a null user_id and are exempt.
create unique index if not exists players_one_seat_idx
  on public.players (game_id, user_id) where user_id is not null;
create index if not exists players_game_idx on public.players (game_id);

create table if not exists public.rounds (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games(id) on delete cascade,
  idx            int not null,
  card_id        text not null,
  mechanic       text not null check (mechanic in ('solo','allplay','guesswho','duel')),
  lane           text check (lane in ('say','do')),
  turn_player_id uuid references public.players(id) on delete set null,
  opponent_id    uuid references public.players(id) on delete set null,
  phase          text not null default 'submitting'
                 check (phase in ('choosing','performing','submitting','revealing','voting','scored')),
  deadline_at    timestamptz,
  results        jsonb,
  created_at     timestamptz not null default now()
);

create unique index if not exists rounds_game_idx_idx on public.rounds (game_id, idx);

create table if not exists public.submissions (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 600),
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create table if not exists public.votes (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.rounds(id) on delete cascade,
  voter_id         uuid not null references public.players(id) on delete cascade,
  target_player_id uuid references public.players(id) on delete cascade,
  score            int check (score between 1 and 5),
  guess_player_id  uuid references public.players(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (round_id, voter_id, target_player_id)
);

-- ─── helpers (security definer so RLS policies don't recurse) ───────────────

create or replace function public.is_member(p_game uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from players where game_id = p_game and user_id = auth.uid()
  ) or exists (
    select 1 from games where id = p_game and host_user_id = auth.uid()
  );
$$;

create or replace function public.is_host(p_game uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from games where id = p_game and host_user_id = auth.uid());
$$;

create or replace function public.my_player(p_game uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select id from players where game_id = p_game and user_id = auth.uid() limit 1;
$$;

create or replace function public.round_game(p_round uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select game_id from rounds where id = p_round;
$$;

create or replace function public.round_phase(p_round uuid)
returns text language sql security definer stable set search_path = public as $$
  select phase from rounds where id = p_round;
$$;

-- The client's clock is not trusted; it measures its offset against this.
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now(); $$;

-- ─── row level security ─────────────────────────────────────────────────────

alter table public.games       enable row level security;
alter table public.players     enable row level security;
alter table public.rounds      enable row level security;
alter table public.submissions enable row level security;
alter table public.votes       enable row level security;

-- Joining happens through the join_game RPC, which is security definer and so
-- does not need this policy to be permissive. That means a game row is readable
-- only by people already in it — a stranger cannot enumerate live room codes.
drop policy if exists games_read on public.games;
create policy games_read on public.games
  for select to authenticated using (public.is_member(id));

drop policy if exists players_read on public.players;
create policy players_read on public.players
  for select to authenticated using (public.is_member(game_id));

drop policy if exists rounds_read on public.rounds;
create policy rounds_read on public.rounds
  for select to authenticated using (public.is_member(game_id));

-- THE SEALING POLICY. Your own submission is always yours to see; everyone
-- else's becomes visible only once the host reveals. This is the guarantee the
-- all-play mechanic rests on.
--
-- `voting` must be in the open list: answers stay sealed through `submitting`,
-- but a voter has to be able to read what they are voting on.
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions
  for select to authenticated using (
    player_id = public.my_player(public.round_game(round_id))
    or (
      public.is_member(public.round_game(round_id))
      and public.round_phase(round_id) in ('revealing','voting','scored')
    )
  );

-- Votes stay sealed a phase longer — until scoring — so nobody can watch a
-- tally build and pile on.
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes
  for select to authenticated using (
    voter_id = public.my_player(public.round_game(round_id))
    or (
      public.is_member(public.round_game(round_id))
      and public.round_phase(round_id) = 'scored'
    )
  );

-- No INSERT/UPDATE/DELETE policies anywhere, deliberately: writes only happen
-- inside the security-definer RPCs below.

-- ─── RPCs: lifecycle ────────────────────────────────────────────────────────

create or replace function public.create_game(p_deck text default 'halloween',
                                              p_theme text default 'halloween')
returns public.games language plpgsql security definer set search_path = public as $$
declare
  -- No O/0/I/1: these get read aloud over a video call and misheard.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_game games;
  i int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  for attempt in 1..20 loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into games (code, host_user_id, deck_id, theme_id)
      values (v_code, auth.uid(), p_deck, p_theme)
      returning * into v_game;
      return v_game;
    exception when unique_violation then
      -- Code collided with a live game; try another.
      null;
    end;
  end loop;

  raise exception 'could not allocate a free room code';
end; $$;

create or replace function public.join_game(p_code text, p_name text, p_look jsonb)
returns public.players language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_player players;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  select * into v_game from games
   where code = upper(trim(p_code)) and ended_at is null
   limit 1;
  if not found then raise exception 'no game with that code'; end if;

  -- Rejoining after a refresh keeps your seat, your score and your character.
  select * into v_player from players
   where game_id = v_game.id and user_id = auth.uid();
  if found then
    update players
       set name = coalesce(nullif(trim(p_name), ''), name),
           look = coalesce(p_look, look),
           last_seen = now()
     where id = v_player.id
     returning * into v_player;
    return v_player;
  end if;

  insert into players (game_id, user_id, name, look)
  values (v_game.id, auth.uid(), trim(p_name), coalesce(p_look, '{}'::jsonb))
  returning * into v_player;
  return v_player;
end; $$;

create or replace function public.add_proxy(p_game uuid, p_name text, p_look jsonb)
returns public.players language plpgsql security definer set search_path = public as $$
declare v_player players;
begin
  if not public.is_host(p_game) then raise exception 'host only'; end if;
  insert into players (game_id, user_id, name, look, is_proxy, controlled_by)
  values (p_game, null, trim(p_name), coalesce(p_look, '{}'::jsonb), true,
          public.my_player(p_game))
  returning * into v_player;
  return v_player;
end; $$;

create or replace function public.heartbeat(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update players set last_seen = now()
   where game_id = p_game and user_id = auth.uid();
end; $$;

-- ─── RPCs: driving the game ─────────────────────────────────────────────────

create or replace function public.set_phase(p_game uuid, p_phase text, p_heat int default null)
returns public.games language plpgsql security definer set search_path = public as $$
declare v_game games;
begin
  if not public.is_host(p_game) then raise exception 'host only'; end if;
  update games
     set phase = p_phase,
         heat_cap = coalesce(p_heat, heat_cap)
   where id = p_game
   returning * into v_game;
  return v_game;
end; $$;

create or replace function public.start_round(p_game uuid, p_card text, p_mechanic text,
                                              p_lane text default null,
                                              p_turn uuid default null,
                                              p_opponent uuid default null,
                                              p_phase text default 'submitting',
                                              p_secs int default null)
returns public.rounds language plpgsql security definer set search_path = public as $$
declare v_round rounds; v_idx int;
begin
  if not public.is_host(p_game) then raise exception 'host only'; end if;

  select coalesce(max(idx), 0) + 1 into v_idx from rounds where game_id = p_game;

  insert into rounds (game_id, idx, card_id, mechanic, lane, turn_player_id,
                      opponent_id, phase, deadline_at)
  values (p_game, v_idx, p_card, p_mechanic, p_lane, p_turn, p_opponent, p_phase,
          case when p_secs is null then null
               else now() + make_interval(secs => p_secs) end)
  returning * into v_round;

  update games set round_no = v_idx where id = p_game;
  return v_round;
end; $$;

create or replace function public.advance_round(p_round uuid, p_phase text,
                                                p_secs int default null)
returns public.rounds language plpgsql security definer set search_path = public as $$
declare v_round rounds;
begin
  if not public.is_host(public.round_game(p_round)) then raise exception 'host only'; end if;
  update rounds
     set phase = p_phase,
         deadline_at = case when p_secs is null then null
                            else now() + make_interval(secs => p_secs) end
   where id = p_round
   returning * into v_round;
  return v_round;
end; $$;

-- ─── RPCs: playing ──────────────────────────────────────────────────────────

create or replace function public.submit_answer(p_round uuid, p_text text,
                                                p_player uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_player uuid;
begin
  v_game := public.round_game(p_round);
  if v_game is null then raise exception 'no such round'; end if;

  -- A host may submit on behalf of a proxy player; everyone else submits as
  -- themselves, whatever they claim in the payload.
  if p_player is not null then
    if not public.is_host(v_game) then raise exception 'host only'; end if;
    v_player := p_player;
  else
    v_player := public.my_player(v_game);
  end if;
  if v_player is null then raise exception 'not in this game'; end if;

  if public.round_phase(p_round) <> 'submitting' then
    raise exception 'submissions are closed';
  end if;

  insert into submissions (round_id, player_id, text)
  values (p_round, v_player, p_text)
  on conflict (round_id, player_id) do update set text = excluded.text;
end; $$;

create or replace function public.cast_vote(p_round uuid,
                                            p_target uuid default null,
                                            p_score int default null,
                                            p_guess uuid default null,
                                            p_voter uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_voter uuid;
begin
  v_game := public.round_game(p_round);
  if v_game is null then raise exception 'no such round'; end if;

  if p_voter is not null then
    if not public.is_host(v_game) then raise exception 'host only'; end if;
    v_voter := p_voter;
  else
    v_voter := public.my_player(v_game);
  end if;
  if v_voter is null then raise exception 'not in this game'; end if;

  if public.round_phase(p_round) <> 'voting' then
    raise exception 'voting is closed';
  end if;

  insert into votes (round_id, voter_id, target_player_id, score, guess_player_id)
  values (p_round, v_voter, p_target, p_score, p_guess)
  on conflict (round_id, voter_id, target_player_id)
  do update set score = excluded.score, guess_player_id = excluded.guess_player_id;
end; $$;

-- Spending a Pass costs zero points. This is a hard rule, not a convention:
-- if passing costs anything, the quiet half of the team stops using it.
create or replace function public.spend_pass(p_game uuid, p_player uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  if p_player is not null then
    if not public.is_host(p_game) then raise exception 'host only'; end if;
    v_player := p_player;
  else
    v_player := public.my_player(p_game);
  end if;
  update players set pass_spent = true where id = v_player and game_id = p_game;
end; $$;

create or replace function public.award_whim(p_player uuid, p_points int)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid;
begin
  select game_id into v_game from players where id = p_player;
  if not public.is_host(v_game) then raise exception 'host only'; end if;
  if abs(p_points) > 5 then raise exception 'the Whim is a bonus, not a bailout'; end if;
  update players set score = score + p_points where id = p_player;
end; $$;

-- ─── RPC: scoring (mirrors src/game/scoring.ts) ─────────────────────────────

create or replace function public.score_round(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round   rounds;
  v_points  jsonb := '{}'::jsonb;
  v_notes   jsonb := '{}'::jsonb;
  v_authors jsonb := '{}'::jsonb;
  r record;
  v_median numeric;
begin
  select * into v_round from rounds where id = p_round;
  if not found then raise exception 'no such round'; end if;
  if not public.is_host(v_round.game_id) then raise exception 'host only'; end if;
  if v_round.results is not null then return v_round.results; end if;

  if v_round.mechanic = 'solo' then
    -- Median, not mean: one troll and one loyalist cannot move it.
    select percentile_cont(0.5) within group (order by score)
      into v_median
      from votes
     where round_id = p_round and score is not null
       and voter_id <> coalesce(v_round.turn_player_id, '00000000-0000-0000-0000-000000000000'::uuid);

    v_points := jsonb_build_object(
      v_round.turn_player_id::text, coalesce(round(v_median), 0)::int);
    v_notes := jsonb_build_object(
      v_round.turn_player_id::text,
      case when v_median is null then 'no votes cast'
           else 'median ' || v_median::text end);

  elsif v_round.mechanic = 'allplay' then
    -- A point for submitting, two per vote received.
    for r in select player_id, id from submissions where round_id = p_round loop
      v_points := v_points || jsonb_build_object(r.player_id::text, 1);
      v_authors := v_authors || jsonb_build_object(r.id::text, r.player_id::text);
    end loop;

    for r in
      select target_player_id as pid, count(*)::int as n
        from votes
       where round_id = p_round
         and target_player_id is not null
         and target_player_id <> voter_id
       group by target_player_id
    loop
      v_points := v_points || jsonb_build_object(
        r.pid::text, coalesce((v_points ->> r.pid::text)::int, 0) + r.n * 2);
      v_notes := v_notes || jsonb_build_object(
        r.pid::text, r.n::text || ' vote' || case when r.n = 1 then '' else 's' end);
    end loop;

  elsif v_round.mechanic = 'guesswho' then
    -- Two for a correct guess; one to the author for everyone they fooled.
    for r in select player_id from submissions where round_id = p_round loop
      v_points := v_points || jsonb_build_object(r.player_id::text,
        coalesce((v_points ->> r.player_id::text)::int, 0));
    end loop;

    for r in
      select voter_id, target_player_id, guess_player_id
        from votes
       where round_id = p_round and guess_player_id is not null
         and target_player_id is not null
    loop
      if r.guess_player_id = r.target_player_id then
        v_points := v_points || jsonb_build_object(r.voter_id::text,
          coalesce((v_points ->> r.voter_id::text)::int, 0) + 2);
      else
        v_points := v_points || jsonb_build_object(r.target_player_id::text,
          coalesce((v_points ->> r.target_player_id::text)::int, 0) + 1);
      end if;
    end loop;

  elsif v_round.mechanic = 'duel' then
    declare
      v_a int; v_b int;
      a uuid := v_round.turn_player_id;
      b uuid := v_round.opponent_id;
    begin
      select count(*) into v_a from votes where round_id = p_round and target_player_id = a;
      select count(*) into v_b from votes where round_id = p_round and target_player_id = b;

      v_points := jsonb_build_object(a::text, 1, b::text, 1);
      if v_a > v_b then
        v_points := jsonb_set(v_points, array[a::text], to_jsonb(4));
      elsif v_b > v_a then
        v_points := jsonb_set(v_points, array[b::text], to_jsonb(4));
      else
        -- A draw splits the prize. Sudden death is fun with two extroverts and
        -- miserable with anyone else.
        v_points := jsonb_build_object(a::text, 2, b::text, 2);
      end if;
      v_notes := jsonb_build_object(a::text, v_a::text || ' votes',
                                    b::text, v_b::text || ' votes');
    end;
  end if;

  -- Apply to running totals.
  for r in select key, value from jsonb_each_text(v_points) loop
    update players set score = score + r.value::int where id = r.key::uuid;
  end loop;

  update rounds
     set results = jsonb_build_object('points', v_points, 'notes', v_notes,
                                      'authors', v_authors),
         phase = 'scored'
   where id = p_round;

  return jsonb_build_object('points', v_points, 'notes', v_notes, 'authors', v_authors);
end; $$;

-- ─── grants ─────────────────────────────────────────────────────────────────
-- GRANT and POLICY are separate gates and both are required: the grant decides
-- whether you may touch the table at all, the policy decides which rows you see
-- once you may. Enabling RLS without granting SELECT fails every read with
-- 42501 before a policy is ever consulted.
--
-- SELECT only. Every write goes through the security-definer RPCs below, so a
-- player cannot alter their own score even if a policy were wrong.

grant usage on schema public to anon, authenticated;

grant select on table
  public.games,
  public.players,
  public.rounds,
  public.submissions,
  public.votes
to authenticated;

grant execute on function
  public.create_game(text, text),
  public.join_game(text, text, jsonb),
  public.add_proxy(uuid, text, jsonb),
  public.heartbeat(uuid),
  public.set_phase(uuid, text, int),
  public.start_round(uuid, text, text, text, uuid, uuid, text, int),
  public.advance_round(uuid, text, int),
  public.submit_answer(uuid, text, uuid),
  public.cast_vote(uuid, uuid, int, uuid, uuid),
  public.spend_pass(uuid, uuid),
  public.award_whim(uuid, int),
  public.score_round(uuid),
  public.server_now()
to authenticated;

-- ─── realtime ───────────────────────────────────────────────────────────────
-- Only the authoritative, non-secret tables are published. Submissions and
-- votes are deliberately absent: clients fetch them when the phase flips, so a
-- sealed answer never travels over the wire early.

do $$
begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.rounds;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null; end $$;
