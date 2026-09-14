-- Two more scenarios thread through the middle of the arc: "The Drive"
-- (between the neighbour's driveway and the port checkpoint — the journey
-- there was never actually shown) and "The Loading Dock" (between the supply
-- cache and the stairwell, bridging the drop from the mid-game's 45-80%
-- range down to the finale's 10-30%).
--
-- This is the renumbering the negative-index trick for the warm-ups was
-- built specifically to avoid needing: these two are real, scored questions,
-- so they need their own SEALED-equivalent rows, which means every question
-- after either insertion point shifts. The full 45-row seed below is a
-- complete reseed under the SAME on-conflict-do-update upsert this table has
-- used since it was created — every question_idx from 0 to 8 gets an
-- explicit value, so nothing is left orphaned holding stale content at its
-- old position.
--
-- Old → new: Guilt Trip 0→0, Feuding Neighbour 1→1, [The Drive is new] 2,
-- Checkpoint 2→3, Infiltration 3→4, Supply Cache 4→5,
-- [The Loading Dock is new] 6, Dark Stairwell 5→7, Roof Breach 6→8.
--
-- Safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_games_question_idx_check'
       and pg_get_constraintdef(oid) like '%8%'
  ) then
    alter table public.survival_games
      drop constraint if exists survival_games_question_idx_check;
    alter table public.survival_games
      add constraint survival_games_question_idx_check
      check (question_idx between -2 and 8);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_answers_question_idx_check'
       and pg_get_constraintdef(oid) like '%8%'
  ) then
    alter table public.survival_answers
      drop constraint if exists survival_answers_question_idx_check;
    alter table public.survival_answers
      add constraint survival_answers_question_idx_check
      check (question_idx between -2 and 8);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_scores_question_idx_check'
       and pg_get_constraintdef(oid) like '%8%'
  ) then
    alter table public.survival_scores
      drop constraint if exists survival_scores_question_idx_check;
    alter table public.survival_scores
      add constraint survival_scores_question_idx_check
      check (question_idx between 0 and 8);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'survival_options_question_idx_check'
       and pg_get_constraintdef(oid) like '%8%'
  ) then
    alter table public.survival_options
      drop constraint if exists survival_options_question_idx_check;
    alter table public.survival_options
      add constraint survival_options_question_idx_check
      check (question_idx between 0 and 8);
  end if;
end $$;

-- ─── survival_advance: the running-phase upper bound widens from 6 to 8 ────
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

-- ─── survival_join: the late-joiner backfill loop widens from 0..6 to 0..8 ──
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

  for q in 0..8 loop
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

-- ─── the reseed: all nine questions, explicit, every index 0-8 touched ─────

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
  (2, 0, 'Push through the gridlock on the shoulder', 55,
      'You clip two mirrors and a road sign, but you are through before the street fully seizes shut.'),
  (2, 1, 'Abandon the car, go on foot through backstreets', 65,
      'Slower, but the panic is all on the main road. You lose no distance to anything that matters.'),
  (2, 2, 'Tuck in behind a military convoy and follow', 70,
      'The convoy clears everything ahead of it. You only have to keep up without anyone noticing you are there.'),
  (2, 3, 'Trade your fuel to a stranger for a guaranteed route', 50,
      'The stranger takes the fuel happily and points you down a road that turns out to be a dead end.'),
  (2, 4, 'Wait it out in a parking garage', 45,
      'The roads never really clear. You lose two hours you did not have, and everyone else is already ahead of you in line.'),
  (3, 0, 'Shove a cougher into the AI scanner', 60,
      'The medical lockdown works and you slip out the side gate. The turrets almost track you. You are officially a villain.'),
  (3, 1, 'Hi-vis vest, clipboard, walk briskly', 80,
      'Social engineering remains undefeated. Nobody in the history of security has ever stopped a man carrying a clipboard.'),
  (3, 2, 'Wait in line and keep your head down', 70,
      'You clear the scanner seconds before the riot behind you breaches the perimeter. Boring, unheroic, and correct.'),
  (3, 3, 'Help the guard calm the crowd', 55,
      'Noble. The crowd turns anyway, you go under it, and the guards drag you through the gate with a broken rib.'),
  (3, 4, 'Crawl through the storm drain', 50,
      'You bypass every guard and every scanner. The toxic runoff bypasses your skin and gives you a serious infection.'),
  (4, 0, 'A dead worker''s ID on the IOTA terminal', 75,
      'The IOTA ledger logs your entry and the gate opens clean. Decentralised infrastructure does not care that the grid is down.'),
  (4, 1, 'Type admin and password into the keypad', 65,
      'It works, proving IT negligence outlasts civilisation itself. It also trips a silent alarm you will hear about later.'),
  (4, 2, 'Take the hand with you for the scanners', 50,
      'Modern scanners check blood flow and pulse. Dead tissue reads as dead tissue, the gate refuses it, and the alarms start.'),
  (4, 3, 'Slip in behind an automated cargo truck', 80,
      'Patience pays. Zero contact, zero noise, zero trace. The safest way through a locked door is to let it open for someone else.'),
  (4, 4, 'Beg port authority over the comms box', 55,
      'The AI denies your request. The shouting attracts everything nearby, and you go over razor wire in a considerable hurry.'),
  (5, 0, 'Water and high-calorie protein paste', 75,
      'Hydration and calories are the whole foundation of staying alive. Boring, unglamorous, and very difficult to argue with.'),
  (5, 1, 'The industrial CO2 fire extinguisher', 80,
      'Pragmatism wins. Sub-zero gas blinds anything in front of you, and it is a heavy metal club once the gas runs out.'),
  (5, 2, 'Nothing, and lock the door behind you', 60,
      'You escape cleanly. The screaming you leave behind draws twice as many of them onto your floor.'),
  (5, 3, 'The trauma kit, for the injured outside', 50,
      'You save a life in the hallway. Now there are two of you, with no food and no weapon, moving at half speed.'),
  (5, 4, 'A solar battery bank and a smart radio', 55,
      'Information is comforting. A radio has never once stopped a set of teeth from closing on a forearm.'),
  (6, 0, 'Sprint straight across the open dock floor', 40,
      'Fast, and exposed the entire way. Something gets a hand on your jacket; you shed it and keep moving.'),
  (6, 1, 'Hug the container stacks, one to the next', 55,
      'Slower, but you are never in the open for more than a few seconds at a time.'),
  (6, 2, 'Climb over a stalled forklift, through a broken window', 45,
      'The glass takes a piece out of your forearm on the way through. You are through, and bleeding.'),
  (6, 3, 'Drop a radio at the far end to draw them off', 60,
      'It works better than it has any right to. You walk straight past what used to be a crowd.'),
  (6, 4, 'Grab a length of pipe and go loud', 30,
      'You make it, technically. You will feel every part of this for days, if there turn out to be days left to feel it in.'),
  (7, 0, 'Trip the stranger running beside you', 25,
      'You only have to outrun them, not the horde. They grab your ankle on the way down and take you with them.'),
  (7, 1, 'Throw loose change down the stairwell', 30,
      'The clatter pulls everything below you away. It also tells everything above you exactly which floor you are on.'),
  (7, 2, 'Shoes off, climb in total silence', 20,
      'You are genuinely silent. You are also barefoot on an exposed wire and broken glass, in absolute darkness.'),
  (7, 3, 'Hold your phone light up for the group', 10,
      'You have made yourself the only bright object in a pitch-black shaft. They come to the light. All of them.'),
  (7, 4, 'Climb outside the railing, over the drop', 15,
      'Your grip fails somewhere around the twenty-second floor. You vault back over the rail alive and completely spent.'),
  (8, 0, 'Smear yourself in infected blood', 15,
      'This is not that kind of virus. It tracks thermal signature, not smell. You have given yourself sepsis for nothing.'),
  (8, 1, 'Wrap up in a silver space blanket', 30,
      'The foil scrambles their thermal read just enough. They stream straight past you toward the helipad.'),
  (8, 2, 'Push a generator against the door', 25,
      'Heavy machinery buys you a handful of breaths before the sheer mass of bodies shoves it aside.'),
  (8, 3, 'Stand at the door and hold them off', 10,
      'Fifty bodies against one. Heroic, quotable, and over before the others have finished boarding.'),
  (8, 4, 'Jam the door''s hydraulic gears', 20,
      'The gears eat your weapon without slowing down, and the door opens exactly as it was always going to.')
on conflict (question_idx, option_index) do update
  set label        = excluded.label,
      survival_pct = excluded.survival_pct,
      outcome      = excluded.outcome;

notify pgrst, 'reload schema';
