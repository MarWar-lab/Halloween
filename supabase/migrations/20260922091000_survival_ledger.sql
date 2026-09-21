-- The berth digits become something the room solves, and a ledger to solve them on.
--
-- Until now a green berth's digit was simply SHOWN to one player for one
-- round — `survival_clue_digits`, visible while that question was current —
-- and the whole challenge was remembering it. That is attention and memory,
-- not problem solving, and it gave nobody a reason to talk to anybody
-- outside their own team: every team assembled all four digits alone.
--
-- Each green berth is now a puzzle. Five candidate manifest lines, one
-- verification rule per player, and exactly one line that satisfies all of
-- them; its seal is the digit. The generator lives in src/survival/puzzles.ts
-- and is checked there as properties over hundreds of seeds. Two of those
-- properties are the whole design:
--
--   No single team holds enough fragments to solve a berth alone.
--   No single fragment is indispensable, so one quiet player cannot strand
--   the room. Four rules discriminate; the rest restate them.
--
-- THE LEDGER. Fragments are private to their holder until posted, and
-- posting is a tap. That asymmetry is the mechanic: a fragment you keep is a
-- fragment that helps nobody, so a berth only comes together when enough
-- people give something away — to people who are racing them for the same
-- seat. Asking is a tap too, because the third of any team that will not
-- speak up on a call must still be able to say "I need berth 4".
--
-- What is NOT here: the answer. `survival_berth_puzzles.answer_line_id` has
-- RLS on with no policy and no grant, the same two shut gates
-- `survival_options` and `survival_keys` use. A player reading their own
-- fragment row learns their rule and nothing else.
--
-- Safe to re-run.

-- ─── tables ─────────────────────────────────────────────────────────────────

-- The board. Public: a manifest is a published ledger, and hiding the
-- candidate lines would make the puzzle about finding them rather than about
-- reasoning over them.
-- `berth` is which PUZZLE this line belongs to; `line_berth` is the berth the
-- line itself claims. They are usually the same and must not be one column:
-- the whole point of the berthIs decoy is that it claims a different berth,
-- and collapsing the two silently made that decoy identical to the answer.
create table if not exists public.survival_berth_lines (
  game_id    uuid not null references public.survival_games(id) on delete cascade,
  berth      int not null check (berth between 1 and 4),
  line_id    int not null check (line_id between 1 and 5),
  line_berth int not null check (line_berth between 1 and 4),
  seal       int not null check (seal between 0 and 9),
  signed_at  int not null,
  signer     text not null,
  primary key (game_id, berth, line_id)
);
alter table public.survival_berth_lines
  add column if not exists line_berth int not null default 1;
alter table public.survival_berth_lines enable row level security;
drop policy if exists survival_berth_lines_select on public.survival_berth_lines;
create policy survival_berth_lines_select on public.survival_berth_lines
  for select using (public.survival_is_member(game_id));
grant select on public.survival_berth_lines to authenticated;

-- THE ANSWER. RLS on, no policy, no grant — two gates, both shut, exactly as
-- survival_options and survival_keys are. Only survival_solve_berth reads it.
create table if not exists public.survival_berth_answers (
  game_id        uuid not null references public.survival_games(id) on delete cascade,
  berth          int not null check (berth between 1 and 4),
  answer_line_id int not null,
  primary key (game_id, berth)
);
alter table public.survival_berth_answers enable row level security;
revoke all on public.survival_berth_answers from anon, authenticated;

-- One fragment per player per berth. A player may read their OWN row and
-- nobody else's — the whole point is that you have to ask.
create table if not exists public.survival_fragments (
  game_id   uuid not null references public.survival_games(id) on delete cascade,
  berth     int not null check (berth between 1 and 4),
  player_id uuid not null references public.survival_players(id) on delete cascade,
  rule      jsonb not null,
  primary key (game_id, berth, player_id)
);
alter table public.survival_fragments enable row level security;
drop policy if exists survival_fragments_own on public.survival_fragments;
create policy survival_fragments_own on public.survival_fragments
  for select using (player_id = public.survival_my_player(game_id));
grant select on public.survival_fragments to authenticated;

-- The ledger itself. A post is public the moment it exists; that is what
-- posting means.
create table if not exists public.survival_posts (
  game_id    uuid not null references public.survival_games(id) on delete cascade,
  berth      int not null check (berth between 1 and 4),
  player_id  uuid not null references public.survival_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, berth, player_id)
);
alter table public.survival_posts enable row level security;
drop policy if exists survival_posts_select on public.survival_posts;
create policy survival_posts_select on public.survival_posts
  for select using (public.survival_is_member(game_id));
grant select on public.survival_posts to authenticated;

create table if not exists public.survival_asks (
  game_id   uuid not null references public.survival_games(id) on delete cascade,
  berth     int not null check (berth between 1 and 4),
  player_id uuid not null references public.survival_players(id) on delete cascade,
  primary key (game_id, berth, player_id)
);
alter table public.survival_asks enable row level security;
drop policy if exists survival_asks_select on public.survival_asks;
create policy survival_asks_select on public.survival_asks
  for select using (public.survival_is_member(game_id));
grant select on public.survival_asks to authenticated;

-- Who has read a berth off the board. Public — a race nobody can run in
-- secret, and the debrief's record of who actually did the deducing.
create table if not exists public.survival_solves (
  game_id    uuid not null references public.survival_games(id) on delete cascade,
  berth      int not null check (berth between 1 and 4),
  team_no    int,
  player_id  uuid not null references public.survival_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, berth, player_id)
);
alter table public.survival_solves enable row level security;
drop policy if exists survival_solves_select on public.survival_solves;
create policy survival_solves_select on public.survival_solves
  for select using (public.survival_is_member(game_id));
grant select on public.survival_solves to authenticated;

-- ─── which berths are open ──────────────────────────────────────────────────

/**
 * A berth unlocks when its round opens and never closes again.
 *
 * Progressive rather than one-at-a-time on purpose: a fast team works ahead
 * and a slow one catches up, so the host never has to hold the whole room on
 * the slowest solver. The green rounds are fixed content, so this is a
 * literal — `src/survival/questions.ts` is its twin, and seal.test.ts
 * already cross-checks that file against these migrations.
 */
create or replace function public.survival_green_berths()
returns table (berth int, question_idx int) language sql immutable as $$
  select * from (values (1, 1), (4, 3), (2, 5), (3, 8)) as g(berth, question_idx);
$$;
grant execute on function public.survival_green_berths() to authenticated;

create or replace function public.survival_berth_open(p_game uuid, p_berth int)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from public.survival_green_berths() g,
           survival_games game
     where game.id = p_game
       and g.berth = p_berth
       and game.phase not in ('lobby', 'briefing')
       and g.question_idx <= (case when game.phase = 'running' then game.question_idx else 99 end)
  );
$$;
grant execute on function public.survival_berth_open(uuid, int) to authenticated;

-- ─── the Exchange ───────────────────────────────────────────────────────────

/**
 * Publish your fragment.
 *
 * The one purely generous act in the game: it helps whoever is racing you,
 * and the board records that you did it. You cannot publish a rule you do
 * not hold and you cannot alter one — the client sends a berth, never a
 * value, because a manifest is a ledger and not a rumour.
 */
create or replace function public.survival_post_fragment(p_game uuid, p_berth int)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;
  if not public.survival_berth_open(p_game, p_berth) then
    raise exception 'that berth is not open yet';
  end if;
  if not exists (
    select 1 from survival_fragments
     where game_id = p_game and berth = p_berth and player_id = v_player
  ) then raise exception 'you hold nothing for that berth'; end if;

  insert into survival_posts (game_id, berth, player_id)
  values (p_game, p_berth, v_player)
  on conflict (game_id, berth, player_id) do nothing;

  delete from survival_asks
   where game_id = p_game and berth = p_berth and player_id = v_player;
end; $$;
grant execute on function public.survival_post_fragment(uuid, int) to authenticated;

/** Ask the room for a berth. A tap, so it needs no voice. */
create or replace function public.survival_ask_berth(p_game uuid, p_berth int)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;
  if not public.survival_berth_open(p_game, p_berth) then
    raise exception 'that berth is not open yet';
  end if;
  insert into survival_asks (game_id, berth, player_id)
  values (p_game, p_berth, v_player)
  on conflict (game_id, berth, player_id) do nothing;
end; $$;
grant execute on function public.survival_ask_berth(uuid, int) to authenticated;

/** Has this player's team read this berth off the board yet? */
create or replace function public.survival_berth_solved(p_game uuid, p_berth int, p_player uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from survival_solves s
     where s.game_id = p_game and s.berth = p_berth
       and (
         s.player_id = p_player
         or (s.team_no is not null and s.team_no = (
              select team_no from survival_team_members
               where game_id = p_game and player_id = p_player))
       )
  );
$$;
grant execute on function public.survival_berth_solved(uuid, int, uuid) to authenticated;

/**
 * Name the line you think survives every published rule.
 *
 * Right, and your whole team can read the seal off it. Wrong, and nothing
 * happens: no cost, no cooldown, no limit. This is the part of the night
 * that should reward trying something, and the keypad downstairs already
 * carries the stakes.
 *
 * The answer never leaves this function — the client sends a line id and is
 * told yes or no, so a wrong guess teaches it nothing it could not have
 * worked out from the board.
 */
create or replace function public.survival_solve_berth(p_game uuid, p_berth int, p_line int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
  v_team   int;
  v_answer int;
begin
  v_player := public.survival_my_player(p_game);
  if v_player is null then raise exception 'not in this game'; end if;
  if not public.survival_berth_open(p_game, p_berth) then
    raise exception 'that berth is not open yet';
  end if;

  select team_no into v_team from survival_team_members
   where game_id = p_game and player_id = v_player;

  if public.survival_berth_solved(p_game, p_berth, v_player) then return true; end if;

  select answer_line_id into v_answer from survival_berth_answers
   where game_id = p_game and berth = p_berth;
  if v_answer is null or v_answer <> p_line then return false; end if;

  insert into survival_solves (game_id, berth, team_no, player_id)
  values (p_game, p_berth, v_team, v_player)
  on conflict (game_id, berth, player_id) do nothing;

  -- Your team has it now, so your team is no longer asking for it.
  delete from survival_asks
   where game_id = p_game and berth = p_berth
     and (player_id = v_player
          or (v_team is not null and player_id in (
                select player_id from survival_team_members
                 where game_id = p_game and team_no = v_team)));
  return true;
end; $$;
grant execute on function public.survival_solve_berth(uuid, int, int) to authenticated;

/**
 * The fragments that have been published, with their text.
 *
 * survival_fragments returns only your own row — that is the asymmetry the
 * Exchange runs on — so publishing has to be what makes a fragment readable
 * by anybody else, and this function is where that happens. It joins the
 * private table to the public one and returns exactly the rows somebody
 * chose to put on the ledger.
 */
create or replace function public.survival_posted_fragments(p_game uuid)
returns table (berth int, player_id uuid, rule jsonb)
language sql security definer stable set search_path = public as $$
  select f.berth, f.player_id, f.rule
    from survival_posts p
    join survival_fragments f
      on f.game_id = p.game_id and f.berth = p.berth and f.player_id = p.player_id
   where p.game_id = p_game and public.survival_is_member(p_game)
   order by p.created_at;
$$;
grant execute on function public.survival_posted_fragments(uuid) to authenticated;

/**
 * The seals your team has earned, and only those.
 *
 * The board is public and the answer is sealed, so a client cannot work out
 * which line's seal to read even after its team has solved the berth. This
 * hands over the digit for exactly the berths your team has read off the
 * board, and nothing for the rest.
 */
create or replace function public.survival_my_digits(p_game uuid)
returns table (berth int, digit int)
language sql security definer stable set search_path = public as $$
  select a.berth, l.seal
    from survival_berth_answers a
    join survival_berth_lines l
      on l.game_id = a.game_id and l.berth = a.berth and l.line_id = a.answer_line_id
   where a.game_id = p_game
     and public.survival_berth_solved(p_game, a.berth, public.survival_my_player(p_game));
$$;
grant execute on function public.survival_my_digits(uuid) to authenticated;

-- ─── dealing the puzzles ────────────────────────────────────────────────────

/**
 * Build a puzzle per green berth and deal one fragment per player.
 *
 * Called at the lobby→briefing transition, alongside the teams, because the
 * roster is fixed by then and re-dealing later would change the board under
 * a room that is already negotiating over it.
 *
 * This does NOT mirror src/survival/puzzles.ts line for line, and it is not
 * supposed to. The seal mirror exists because the percentages are fixed
 * content that both backends must agree on; a puzzle is per-game random,
 * exactly like the extraction digits already are, so whichever backend runs
 * a game makes up its own. What the two must share is the PROPERTIES —
 * exactly one surviving line, no team able to solve alone, no single
 * fragment indispensable — and those are checked here in
 * scripts/check-migrations.mjs and there in puzzles.test.ts.
 *
 * The construction is the same shape either way, because it is what makes
 * the properties true without having to search for them:
 *
 *   1. The valid line carries the digit.
 *   2. Pick key rules, all true of the valid line.
 *   3. Build each decoy to break exactly ONE key rule. Breaking two would
 *      make the other redundant, and a redundant key rule is a key rule a
 *      team can do without.
 *   4. Pad with rules true of EVERY line, so nobody holds nothing and
 *      nobody is indispensable.
 *   5. Deal the key rules round-robin across teams, so no team holds them all.
 */
create or replace function public.survival_deal_puzzles(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  SIGNERS constant text[] := array['HARBOURMASTER','PORT AUTHORITY','CUSTOMS','NIGHT CREW','TWIN CONTROL'];
  g           record;
  v_digit     int;
  v_seal      int;
  v_signed    int;
  v_signer    text;
  v_other     text;
  v_kinds     text[];
  v_keys      text[];
  v_keyn      int;
  v_players   uuid[];
  v_teams     int[];
  v_n         int;
  d           int;
  v_line      int;
  v_slots     int[];
  v_dseal     int;
  v_dberth    int;
  v_dsigned   int;
  v_dsigner   text;
  v_lo        int;
  v_hi        int;
  v_pad       jsonb[];
  v_rules     jsonb[];
  v_order     int[];
  v_slot      int;
  v_pid       uuid;
  i           int;
begin
  select array_agg(id order by joined_at) into v_players
    from survival_players where game_id = p_game;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n = 0 then return; end if;

  for g in select * from public.survival_green_berths() loop
    select digit into v_digit from survival_clue_digits
     where game_id = p_game and question_idx = g.question_idx;
    continue when v_digit is null;

    v_seal   := v_digit;
    v_signed := 1080 + floor(random() * 330)::int;      -- 18:00 to 23:30
    v_signer := SIGNERS[1 + floor(random() * 5)::int];
    v_other  := SIGNERS[1 + ((array_position(SIGNERS, v_signer) + 1) % 5)::int];

    -- Five discriminating rule kinds; take as many as the room can hold.
    v_kinds := array['berthIs','signerIs','signedAfter','signedBefore','sealParity'];
    select array_agg(k order by random()) into v_kinds from unnest(v_kinds) as k;
    v_keyn := greatest(1, least(v_n, 4));
    v_keys := v_kinds[1:v_keyn];

    delete from survival_berth_lines where game_id = p_game and berth = g.berth;
    delete from survival_fragments   where game_id = p_game and berth = g.berth;
    delete from survival_berth_answers where game_id = p_game and berth = g.berth;

    -- Decide where each line sits up front rather than renumbering after the
    -- fact: a two-step update has to park the ids somewhere out of range on
    -- the way past, and line_id is checked to be 1..5.
    -- A subquery that sorts, not `array_agg(... order by random())`: the
    -- aggregate form left the valid line in slot 1 every single time, which
    -- would have taught the room to just always pick the first line.
    select array_agg(n) into v_slots from (
      select n from generate_series(1, 5) as n order by random()
    ) shuffled;

    insert into survival_berth_lines (game_id, berth, line_id, line_berth, seal, signed_at, signer)
    values (p_game, g.berth, v_slots[1], g.berth, v_seal, v_signed, v_signer);

    for d in 0..3 loop
      v_dberth  := g.berth;
      v_dseal   := v_seal;
      v_dsigned := v_signed;
      v_dsigner := v_signer;
      case v_keys[1 + (d % v_keyn)]
        when 'berthIs'      then v_dberth  := (g.berth % 4) + 1;
        when 'signerIs'     then v_dsigner := v_other;
        when 'signedAfter'  then v_dsigned := v_signed - 60;
        when 'signedBefore' then v_dsigned := v_signed + 60;
        when 'sealParity'   then v_dseal   := (v_seal + 1) % 10;
      end case;
      -- Nudge by TWO, never one: a decoy sharing the answer's seal makes the
      -- deduction optional, and moving a seal by one flips its parity and
      -- would break the parity rule as well as the one it was built to break.
      if v_dseal = v_seal then v_dseal := (v_seal + 2) % 10; end if;
      insert into survival_berth_lines (game_id, berth, line_id, line_berth, seal, signed_at, signer)
      values (p_game, g.berth, v_slots[d + 2], v_dberth, v_dseal, v_dsigned, v_dsigner);
    end loop;

    -- The slot permutation above already placed the valid line somewhere
    -- random, so the answer is simply where it was put.
    v_line := v_slots[1];
    insert into survival_berth_answers (game_id, berth, answer_line_id)
    values (p_game, g.berth, v_line);

    -- Padding true of EVERY line: outside the whole time range, or a berth
    -- no line uses. Never a restatement of a key rule, which would keep
    -- excluding that rule's decoy after the key rule itself was dropped.
    select min(signed_at), max(signed_at) into v_lo, v_hi
      from survival_berth_lines where game_id = p_game and berth = g.berth;
    v_pad := array[
      jsonb_build_object('kind','signedAfter','minutes', v_lo - 1),
      jsonb_build_object('kind','signedBefore','minutes', v_hi + 1)
    ];
    -- The only berths any line carries are the valid one and the berthIs
    -- decoy's, so every other berth is a rule true of the whole board.
    for i in 1..4 loop
      if i <> g.berth and i <> (g.berth % 4) + 1 then
        v_pad := v_pad || jsonb_build_object('kind','berthIsNot','berth', i);
      end if;
    end loop;

    -- The key rules, as stored.
    v_rules := array[]::jsonb[];
    for i in 1..v_keyn loop
      v_rules := v_rules || (case v_keys[i]
        when 'berthIs'      then jsonb_build_object('kind','berthIs','berth', g.berth)
        when 'signerIs'     then jsonb_build_object('kind','signerIs','signer', v_signer)
        when 'signedAfter'  then jsonb_build_object('kind','signedAfter','minutes', v_signed - 30)
        when 'signedBefore' then jsonb_build_object('kind','signedBefore','minutes', v_signed + 30)
        else                     jsonb_build_object('kind','sealParity','even', (v_seal % 2 = 0))
      end);
    end loop;

    -- Deal: key rules round-robin across teams in a shuffled order, so with
    -- two or more teams no team can hold all of them. Everyone else takes
    -- padding.
    select array_agg(distinct team_no) into v_teams from survival_team_members where game_id = p_game;
    v_order := array[]::int[];
    if v_teams is not null then
      select array_agg(t order by random()) into v_order from unnest(v_teams) as t;
    end if;

    v_slot := 0;
    for i in 1..v_keyn loop
      if array_length(v_order, 1) is null then
        v_pid := v_players[1 + ((i - 1) % v_n)];
      else
        select player_id into v_pid from survival_team_members m
         where m.game_id = p_game
           and m.team_no = v_order[1 + (v_slot % array_length(v_order, 1))]
           and not exists (select 1 from survival_fragments f
                            where f.game_id = p_game and f.berth = g.berth and f.player_id = m.player_id)
         limit 1;
        v_slot := v_slot + 1;
      end if;
      if v_pid is not null then
        insert into survival_fragments (game_id, berth, player_id, rule)
        values (p_game, g.berth, v_pid, v_rules[i])
        on conflict (game_id, berth, player_id) do nothing;
      end if;
    end loop;

    i := 0;
    for v_pid in select unnest(v_players) loop
      if not exists (select 1 from survival_fragments
                      where game_id = p_game and berth = g.berth and player_id = v_pid) then
        insert into survival_fragments (game_id, berth, player_id, rule)
        values (p_game, g.berth, v_pid, v_pad[1 + (i % array_length(v_pad, 1))]);
        i := i + 1;
      end if;
    end loop;
  end loop;
end; $$;
grant execute on function public.survival_deal_puzzles(uuid) to authenticated;
revoke all on function public.survival_deal_puzzles(uuid) from public;

-- ─── deal at the briefing ───────────────────────────────────────────────────

create or replace function public.survival_advance(p_game uuid)
returns public.survival_games language plpgsql security definer set search_path = public as $$
declare v_game survival_games;
begin
  select * into v_game from survival_games where id = p_game;
  if not found then raise exception 'no such game'; end if;
  if not public.survival_is_host(p_game) then raise exception 'host only'; end if;

  if v_game.phase = 'lobby' then
    update survival_games set phase = 'briefing' where id = p_game;
    if v_game.mode = 'consensus' then
      perform public.survival_assign_teams(p_game);
    end if;
    -- Dealt for every mode, not just consensus: solo play still needs a
    -- board to reason over, it just cannot spread the fragments across
    -- teams, which is one more reason consensus is the mode worth running.
    perform public.survival_deal_puzzles(p_game);
  elsif v_game.phase = 'briefing' then
    update survival_games set phase = 'running', question_idx = -2, revealed = false
     where id = p_game;
  elsif v_game.phase = 'running' then
    if not v_game.revealed then raise exception 'reveal this one first'; end if;
    if v_game.question_idx < 8 then
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

notify pgrst, 'reload schema';
