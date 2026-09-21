/**
 * How big the night is, given who turned up.
 *
 * Every one of these numbers used to be a constant tuned for "about nine
 * people" — `SEATS = 3`, and teams cut into pairs with `Math.floor(n / 2)`.
 * Five players made the tribunal trivial; twenty made it pointless, because
 * three seats out of twenty means seventeen people spend the evening with no
 * path to one.
 *
 * Pure, so both backends and the SQL can be checked against the same table of
 * expected answers.
 */

/**
 * Seats on the last chopper.
 *
 * Two rules fight here. Scarcity has to stay roughly constant — a seat that
 * most of the room gets is not a seat anybody plays for — so the base figure
 * is a quarter of the room. But the three ways to win a seat (the code, the
 * record, the vote) each need one to claim, or a whole phase of the night
 * decides nothing, so three is the floor as soon as the room is big enough to
 * support it.
 *
 * The `n - 2` ceiling is the one that matters least often and costs the most
 * when it is missing: at least two people must be left behind, or the ending
 * is a formality.
 */
export function seatsFor(playerCount: number): number {
  if (playerCount <= 0) return 0;
  const quarter = Math.max(3, Math.round(playerCount / 4));
  return Math.max(1, Math.min(playerCount - 2, quarter));
}

/**
 * How many teams to cut the room into.
 *
 * Threes and fours, not pairs. A pair is two people taking turns; three is the
 * smallest group where somebody can be quiet for a minute and the
 * conversation still happens without them — which is the whole point, given a
 * third of any team will not perform on camera.
 *
 * Never fewer than two teams once there are four people, because the puzzles
 * are dealt across teams: one team holding everything is the failure mode the
 * split exists to prevent.
 */
export function teamsFor(playerCount: number): number {
  if (playerCount <= 0) return 0;
  const byTargetSize = Math.max(2, Math.round(playerCount / 3.5));
  // A team needs two people to be a team, so the count can never exceed half
  // the room however much we would like threes.
  return Math.max(1, Math.min(Math.floor(playerCount / 2), byTargetSize));
}

/**
 * The size of each team, largest first.
 *
 * Spread the remainder across the leading teams rather than dumping it on the
 * last one — twenty players in six teams is 4,4,3,3,3,3, not 3,3,3,3,3,5. The
 * old pairing put every leftover in the final team, so at nine players one
 * trio carried an extra person for no reason anybody could see.
 */
export function teamSizes(playerCount: number, teamCount = teamsFor(playerCount)): number[] {
  if (playerCount <= 0 || teamCount <= 0) return [];
  const base = Math.floor(playerCount / teamCount);
  const remainder = playerCount % teamCount;
  return Array.from({ length: teamCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Cut an already-shuffled list into teams of those sizes.
 *
 * Takes the order it is given and never re-orders it: the caller shuffles, so
 * that "who ends up with whom" stays one decision made in one place, testable
 * with a fixed list.
 */
export function partitionInto<T>(items: T[], teamCount = teamsFor(items.length)): T[][] {
  const sizes = teamSizes(items.length, teamCount);
  const out: T[][] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/**
 * What the evening should cost, door to door, for a room this size.
 *
 * Discussion is the part that scales with headcount, not the questions —
 * twenty people reacting to a reveal takes longer than five, and the puzzles
 * add a negotiation that eight people finish while twenty are still finding
 * each other. Capped, because past an hour it is not a game night.
 */
export function targetMinutesFor(playerCount: number): number {
  return 45 + Math.max(0, Math.min(15, playerCount - 8));
}
