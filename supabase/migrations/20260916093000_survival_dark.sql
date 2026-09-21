-- Which choices are "ruthless" — content only, no constraint or function
-- change. Mirrors DARK_CHOICES in src/survival/questions.ts exactly;
-- src/survival/seal.test.ts fails the build if the two disagree.
--
-- Declarative and authoritative: the first statement clears every flag, the
-- second sets exactly the rows below. A later migration that changes this
-- list must repeat the WHOLE list, the same way survival_options' reseed
-- migrations always restate every row rather than layering a diff — because
-- the first statement here resets everything, a partial second statement
-- would silently drop whatever it left out.
--
-- Safe to re-run.

update public.survival_options set ruthless = false;

update public.survival_options set ruthless = true
 where (question_idx, option_index) in (
   (0, 2), -- The Guilt Trip — block their number and barricade the door
   (1, 2), -- The Feuding Neighbour — golf club to the head, take the SUV
   (2, 2), -- The Drive — speed up and pretend you did not see them
   (2, 4), -- The Drive — let them argue it out, take the winner
   (3, 0), -- The Checkpoint — shove a cougher into the AI scanner
   (4, 2), -- The Infiltration — take the hand with you for the scanners
   (5, 2), -- The Supply Cache — nothing, and lock the door behind you
   (6, 1), -- The Loading Dock — give them a decoy route instead
   (7, 0)  -- The Dark Stairwell — trip the stranger running beside you
   -- The Roof Breach (question_idx 8) carries no dark option at all: every
   -- choice there only risks the player.
 );
