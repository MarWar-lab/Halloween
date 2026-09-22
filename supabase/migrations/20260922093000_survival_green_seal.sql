-- A green berth's digit was still directly readable through the OLD path —
-- the puzzle system never actually closed it.
--
-- survival_clue_digits_read gated a clued round's digit on nothing but "is
-- this round current" and, in consensus mode, "am I the assigned seer." That
-- policy predates the berth puzzles and was never narrowed when they
-- shipped: it makes no distinction between a red decoy (attention only,
-- never the code) and a green berth (the actual answer the Exchange, the
-- fragments and the whole no-team-solves guarantee exist to protect). The
-- result was that the seer for a green round — or, in solo mode, anyone at
-- all — could read `survival_clue_digits` directly and skip the puzzle
-- entirely. Every fragment, every post to the ledger, every property
-- checked in puzzles.test.ts was decorative for as long as this stood.
--
-- The fix is one clause: a green round's question_idx is now excluded from
-- what this policy will ever return, full stop, regardless of mode or seer
-- assignment. `survival_green_berths()` already lists exactly those
-- question indices — it was added for the puzzle deal and is reused here
-- rather than duplicated. Red rounds are unaffected: they carry no answer
-- to protect, and the seer indirection around them is unchanged.
--
-- Safe to re-run.

drop policy if exists survival_clue_digits_read on public.survival_clue_digits;
create policy survival_clue_digits_read on public.survival_clue_digits
  for select to authenticated using (
    public.survival_is_member(game_id)
    and public.survival_current(game_id, question_idx)
    and question_idx not in (select g.question_idx from public.survival_green_berths() g)
    and (
      (select mode from survival_games where id = game_id) <> 'consensus'
      or public.survival_my_clue_seer(game_id, question_idx) is null
      or public.survival_my_clue_seer(game_id, question_idx) = public.survival_my_player(game_id)
    )
  );

notify pgrst, 'reload schema';
