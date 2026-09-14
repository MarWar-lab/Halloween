/**
 * The Last Screen Standing — its own vocabulary.
 *
 * Deliberately shares nothing with the Campfire engine next door. That game is
 * about cards, heat and anonymous answers; this one is about a run of
 * scripted questions and one number you are not allowed to tell anybody.
 */

/** Where the night has got to. Mirrors survival_games.phase exactly. */
export type Phase = 'lobby' | 'briefing' | 'running' | 'plea' | 'tribunal' | 'result';

/** How many questions are answered by choosing a move. The plea is separate. */
export const CHOICE_QUESTIONS = 9;

export interface Game {
  id: string;
  code: string;
  hostUserId: string;
  phase: Phase;
  /** Which choice question is in front of the room, 0-based. */
  questionIdx: number;
  /** Whether that question's outcomes are open to the room. */
  revealed: boolean;
  createdAt: string;
}

export interface Player {
  id: string;
  gameId: string;
  userId: string | null;
  name: string;
  lastSeen: string;
}

/**
 * Which move somebody made. Public once the question is revealed — watching
 * who chose what is the whole conversation.
 */
export interface Answer {
  playerId: string;
  questionIdx: number;
  optionIndex: number;
  /** True when the game chose for you: you went quiet, or you joined late. */
  autoAssigned: boolean;
}

/**
 * What a move cost you.
 *
 * There is no `playerId` here on purpose. These are only ever your own rows
 * until the tribunal, and a field for somebody else's would be an invitation
 * to fill it in.
 */
export interface MyScore {
  questionIdx: number;
  survivalPct: number;
}

export interface Plea {
  playerId: string;
  text: string;
}

export interface Vote {
  voterId: string;
  targetPlayerId: string;
}

/** One of the five moves, once the question is open. Never carries a figure. */
export interface RevealRow {
  optionIndex: number;
  label: string;
  outcome: string;
  takers: number;
}

export interface Standing {
  playerId: string;
  name: string;
  rounds: number;
  /** Odds of having survived every scored round, per survivalOddsOf — a
      product, not a mean. Named `average` on the wire; kept, to avoid a
      migration over a field name no client reads as a label anyway. */
  average: number;
}

export interface Winner {
  playerId: string;
  name: string;
  votes: number;
  /** Same odds as Standing.average, and the same reason the name stuck. */
  average: number;
}

/** Everything one viewer is allowed to know right now. */
export interface Snapshot {
  game: Game;
  players: Player[];
  /** Only the answers this viewer may see: your own, plus revealed questions. */
  answers: Answer[];
  /** Yours alone, until the tribunal opens everybody's. */
  myScores: MyScore[];
  pleas: Plea[];
  votes: Vote[];
  /**
   * Who has acted, and never what they did. The host cannot run the game
   * without knowing when the room has finished, and at every one of these
   * moments the substance is sealed — so the fact travels and the content
   * does not.
   */
  answeredPlayerIds: string[];
  pleadedPlayerIds: string[];
  votedPlayerIds: string[];
  /** The five outcomes, once the host has opened them. */
  reveal: RevealRow[] | null;
  /** Everybody's rate. Null until the tribunal, because it is refused before. */
  standings: Standing[] | null;
  /** Who takes the seat. More than one row means the room could not split them. */
  winner: Winner[] | null;
}

/** Letters are how the host reads a move aloud, so they live in one place. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * Your odds of having survived every question you have a figure for — the
 * product of each one's chance, not their average.
 *
 * A round's percentage is the chance you make it through THAT round alone. To
 * still be standing after several of them, you have to make it through all of
 * them, and the chance of several independent things all going your way is
 * their product, not their mean: 75% and then 70% is a 52.5% chance of both,
 * not a 72.5% chance of "one of them, on average." An arithmetic mean also
 * cannot fall as the night goes on no matter how bad your calls get, which
 * contradicts the entire premise of the game — every extra round survived is
 * a longer odds bet, and the number on screen has to say so.
 *
 * Null rather than zero when there is nothing yet: "has not played" and "died
 * every time" are different facts, and a screen showing 0% for the first is a
 * lie about somebody who has done nothing wrong. A true zero can still occur
 * honestly — a 0% round makes every subsequent product zero, correctly, since
 * surviving nothing at all is surviving nothing at all.
 */
export function survivalOddsOf(scores: MyScore[]): number | null {
  const precise = survivalOddsPrecise(scores);
  return precise === null ? null : Math.round(precise * 10) / 10;
}

/**
 * The same product, unrounded — for comparing two players, never for display.
 *
 * Seven compounding rounds routinely lands everyone's odds near zero: even a
 * run of good calls (75, 70, 80, 80, 80, 30, 30) compounds to about 2.4%, and
 * a run of bad ones can round to "0.0%" outright. Two different players can
 * share that same rounded number while their real odds are still ordered —
 * a tie-break, or a ranking, decided on the rounded figure would call that an
 * honest tie when it is not one. Compare on this instead, and round only the
 * number a human actually reads.
 */
export function survivalOddsPrecise(scores: MyScore[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((odds, s) => odds * (s.survivalPct / 100), 1) * 100;
}
