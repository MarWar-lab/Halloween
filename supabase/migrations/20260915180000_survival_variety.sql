-- The Drive and The Loading Dock were the same card wearing different words:
-- brave route, sneaky route, obstacle route, trick route, violent route. The
-- arc already had four questions shaped exactly like that (Checkpoint,
-- Infiltration, Dark Stairwell, Roof Breach); adding two more of the same
-- shape made six of nine questions "how do I get past this danger physically"
-- with only Guilt Trip, Feuding Neighbour and Supply Cache differently
-- textured.
--
-- Rewritten, not moved: same question_idx (2 and 6), same position in the
-- arc, same rough odds band for where they sit in the difficulty curve —
-- only the dilemma itself changes. The Drive is now a Guilt-Trip-shaped
-- moral call (who gets the one open seat) rather than an obstacle course.
-- The Loading Dock is now an information dilemma (answer the radio and help
-- a stranger, or protect your own position) — new to the arc entirely.
--
-- Content-only. No constraint, no function, no question count changes —
-- just an upsert over two already-existing question_idx values.
-- Safe to re-run.

insert into public.survival_options (question_idx, option_index, label, survival_pct, outcome) values
  (2, 0, 'Open the door for the closest stranger', 55,
      'They turn out to be exactly what they looked like: exhausted, and grateful. No trouble, but the seat you were saving for someone else is gone.'),
  (2, 1, 'Only take someone who can prove they are clean', 65,
      'The screening costs you time you did not have, but the person you let in stays calm, cooperative, and blessedly boring the rest of the way.'),
  (2, 2, 'Speed up and pretend you did not see them', 70,
      'You do not look back. The guilt rides with you the whole way to the port, uninvited and unpaid for.'),
  (2, 3, 'Point them toward a bus you saw idling back', 50,
      'The bus had already left by the time you sent them to it. You will not find out how that went.'),
  (2, 4, 'Let them argue it out, take the winner', 45,
      'The argument costs you time, and the person who wins the seat is not who you would have picked.'),

  (6, 0, 'Give them the real route to the stairwell', 40,
      'They make it. So does everything close enough to hear you say it out loud.'),
  (6, 1, 'Give them a decoy route instead', 55,
      'It buys you the real path, clean. Somewhere behind you, someone is following directions to nowhere.'),
  (6, 2, 'Stay silent and keep moving', 50,
      'The radio goes quiet on its own eventually. You never find out if that was good news.'),
  (6, 3, 'Answer, but lie about how close it is', 45,
      'The lie holds together right up until it does not, and by then you are already at the door.'),
  (6, 4, 'Smash the radio so you cannot answer again', 60,
      'One problem solved, permanently. You will think about that voice more than you expected to.')
on conflict (question_idx, option_index) do update
  set label        = excluded.label,
      survival_pct = excluded.survival_pct,
      outcome      = excluded.outcome;

notify pgrst, 'reload schema';
