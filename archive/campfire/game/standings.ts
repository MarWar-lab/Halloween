/**
 * One ranking, used by every screen that shows one.
 *
 * The header pill and the standings list below it used to sort differently:
 * the pill by score alone, the list by score then name. On a tie the two
 * disagreed on the same screen — a player read "3RD OF 6" in the header while
 * the list under it put them 2nd. Ties are common in a game where most cards
 * pay one or two points, so this was not a rare corner.
 *
 * Name then id as tiebreaks, so the order is total and stable: two players
 * with the same score and the same name still rank consistently everywhere.
 */
export type Rankable = { id: string; name: string; score: number };

export function ranked<T extends Rankable>(players: readonly T[]): T[] {
  return [...players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** 1-based position in the ranking, or null if the player is not in it. */
export function rankOf(players: readonly Rankable[], playerId: string | null | undefined): number | null {
  if (!playerId) return null;
  const i = ranked(players).findIndex((p) => p.id === playerId);
  return i === -1 ? null : i + 1;
}
