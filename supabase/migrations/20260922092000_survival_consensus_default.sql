-- Consensus becomes the default mode, not an opt-in a host has to remember.
--
-- Solo mode is nine parallel single-player polls with a shared reveal
-- screen — the only thing binding the room together is the vote at the very
-- end. Consensus is what makes the rest of the night mean something: a team
-- answers together, and the berth puzzles split their key rules across
-- teams specifically so a green berth cannot be solved by one team alone.
-- None of that happens unless a host remembers to flip a toggle in the
-- lobby before starting.
--
-- This only changes what a NEW game gets when nothing says otherwise. A
-- host can still switch a lobby to solo — survival_set_mode is untouched,
-- and the toggle in the console still works both ways. Games already in
-- flight keep whatever mode they were created with; changing a column
-- default never touches existing rows.
--
-- Safe to re-run.

alter table public.survival_games alter column mode set default 'consensus';

notify pgrst, 'reload schema';
