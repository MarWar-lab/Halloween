/**
 * The bunker map's one input: a single 0-1 tension value, computed only from
 * facts the room already publishes.
 *
 * The whole design of this game is that your own survival percentage is
 * yours — nobody else's client ever legitimately holds it. So the bunker map
 * (see `scene/BunkerMap.tsx`) cannot be driven by odds at all: it is built
 * entirely out of fields `Snapshot` already exposes to every viewer —
 * who's answered, who's stuck on a keypad, how much of the ledger is still
 * being hoarded, how far the tribunal has got. Nothing here is a new secret,
 * and nothing here needs a migration.
 *
 * `computeTension` is pure and takes a `Snapshot`-shaped object rather than
 * the type itself so it can be tested with small hand-built fixtures instead
 * of a full snapshot.
 */

export interface TensionInput {
  phase: 'lobby' | 'briefing' | 'running' | 'plea' | 'tribunal' | 'result';
  playerCount: number;
  answeredCount: number;
  pleadedCount: number;
  votedCount: number;
  escapedCount: number;
  teamAttempts: number;
  /** Per unlocked berth: fragments posted so far vs. how many exist to post,
   * plus how many people are actively asking for help on it right now. */
  puzzles: { posted: number; total: number; asking: number; solved: boolean }[];
}

const BASE_TENSION: Record<TensionInput['phase'], number> = {
  lobby: 0,
  briefing: 0.05,
  running: 0.15,
  plea: 0.45,
  tribunal: 0.6,
  result: 0,
};

/** Fraction of the room still waiting to act, 0 when there is nobody to wait on. */
function pendingFraction(acted: number, of: number): number {
  if (of <= 0) return 0;
  return 1 - Math.min(1, acted / of);
}

/**
 * How much of the ledger is still sitting in people's pockets.
 *
 * A berth nobody has posted anything for is neutral — it hasn't opened yet.
 * A berth with fragments posted but not yet solved is the tense case: the
 * room has started and is stuck. Solved berths contribute nothing.
 *
 * A live "asking" count is a sharper signal than posted-fragment ratio
 * alone: it is people saying, right now, that they are blocked — so it is
 * weighted more heavily per berth than the raw ratio, and (unlike the
 * ratio) it counts even on a berth nobody has posted to yet, since asking
 * before posting is exactly what the mechanic wants people to do.
 */
function hoardingFraction(puzzles: TensionInput['puzzles']): number {
  const unsolved = puzzles.filter((p) => !p.solved);
  if (unsolved.length === 0) return 0;
  const perBerth = unsolved.map((p) => {
    const stuckness = p.posted > 0 ? 1 - Math.min(1, p.posted / Math.max(1, p.total)) : 0;
    const askedFor = Math.min(1, p.asking / Math.max(1, p.total));
    return Math.max(stuckness, askedFor);
  });
  return perBerth.reduce((sum, v) => sum + v, 0) / perBerth.length;
}

/** The `TensionInput` this game's actual snapshot maps to — kept separate
 * from `computeTension` so the arithmetic above stays testable on small
 * hand-built fixtures instead of a full `Snapshot`. */
export function tensionInputFromSnapshot(snapshot: {
  game: { phase: TensionInput['phase'] };
  players: unknown[];
  answeredPlayerIds: unknown[];
  pleadedPlayerIds: unknown[];
  votedPlayerIds: unknown[];
  escapedPlayerIds: unknown[];
  teamAttempts: number;
  puzzles: { posted: unknown[]; lines: unknown[]; askingPlayerIds: unknown[]; firstSolvedBy: unknown }[];
}): TensionInput {
  return {
    phase: snapshot.game.phase,
    playerCount: snapshot.players.length,
    answeredCount: snapshot.answeredPlayerIds.length,
    pleadedCount: snapshot.pleadedPlayerIds.length,
    votedCount: snapshot.votedPlayerIds.length,
    escapedCount: snapshot.escapedPlayerIds.length,
    teamAttempts: snapshot.teamAttempts,
    puzzles: snapshot.puzzles.map((p) => ({
      posted: p.posted.length,
      // Roughly one fragment dealt per player is the natural "full" count;
      // `lines.length` (always 5) is a floor so a tiny room's berth doesn't
      // read as solved after a single post.
      total: Math.max(p.lines.length, snapshot.players.length),
      asking: p.askingPlayerIds.length,
      solved: p.firstSolvedBy != null,
    })),
  };
}

export function computeTension(input: TensionInput): number {
  const base = BASE_TENSION[input.phase];

  const waiting = input.phase === 'running'
    ? pendingFraction(input.answeredCount, input.playerCount)
    : input.phase === 'plea'
      ? pendingFraction(input.pleadedCount, input.playerCount)
      : input.phase === 'tribunal'
        ? pendingFraction(input.votedCount, input.playerCount)
        : 0;

  const hoarding = hoardingFraction(input.puzzles);

  // Wrong keypad guesses are the room actively failing at something, so they
  // weigh in regardless of phase — capped so one unlucky team can't pin the
  // whole map at maximum for the rest of the night.
  const fumbling = Math.min(1, input.teamAttempts / 6);

  // Every escape lowers the room's collective jeopardy a little, independent
  // of anything else — fewer people left with something to lose.
  const relief = input.playerCount > 0 ? input.escapedCount / input.playerCount : 0;

  const raw = base + waiting * 0.3 + hoarding * 0.25 + fumbling * 0.2 - relief * 0.15;
  return Math.max(0, Math.min(1, raw));
}
