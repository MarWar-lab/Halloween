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

/** Seats on the last chopper. Three, and they are not all won the same way. */
export const SEATS = 3;

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
  /**
   * 'solo' (the default): every player answers alone. 'consensus': players
   * are grouped into small teams before the briefing, and a team answers
   * together — whichever member taps first locks the choice in for all of
   * them. Host-set, lobby-only; see `Snapshot.myTeam`.
   */
  mode: 'solo' | 'consensus';
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

export interface Seat {
  playerId: string;
  name: string;
  /** Which of the SEATS seats this is (1-based), not a ranking. */
  seat: number;
  /** How this seat was won — the code, or the room's vote. */
  path: 'escape' | 'vote';
  /**
   * Meaningless for a seat taken by `path: 'escape'` — an escapee can't be
   * voted for, so this is always 0 for them. The screen branches on `path`,
   * never on this being zero.
   */
  votes: number;
  /** Same odds as Standing.average, and the same reason the name stuck. */
  average: number;
  /** 1-based solve rank, `path: 'escape'` only; null for a vote seat. */
  solveOrder: number | null;
  /** True only when this seat is shared: more players tied than the seat allows. */
  contested: boolean;
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
  /** Who takes a seat. More rows than SEATS means the last one is contested. */
  seats: Seat[] | null;
  /**
   * The current round's extraction-manifest digit, if this round carries one
   * — gone the instant the host advances, by design: reconstructing the code
   * means having written it down when it was here, not scrolling back.
   *
   * In consensus mode, only one member of each team — the round's randomly
   * assigned "seer" — actually receives this. Everyone else on that team
   * gets `clueSeer` instead: a name, not a digit, so the only way to learn
   * it is to ask. Solo mode, and a teamless player, see it exactly like
   * today: unconditionally, the moment the round opens.
   */
  clue: { questionIdx: number; digit: number } | null;
  /**
   * Who to ask, when this round carries a clue and it isn't you who saw it.
   * Null whenever `clue` is populated (no need to tell yourself to ask
   * yourself), in solo mode, or when this round carries nothing at all.
   */
  clueSeer: { name: string } | null;
  /**
   * Who has escaped by stating the extraction code, in the order they did —
   * public from the moment the keypad opens. Knowing somebody solved it
   * tells you nothing about what they typed, so there is nothing to protect
   * by hiding this.
   */
  escapedPlayerIds: string[];
  /**
   * Seconds until I may try the extraction code again. 0 means I'm free to.
   * There is no lockout state — only ever a short, well-telegraphed pause
   * after a wrong guess. In consensus mode this is shared across the whole
   * team (any teammate's wrong guess starts everyone's cooldown, the same
   * way a shared keypad would), not just the one who typed it.
   */
  retryInSeconds: number;
  /**
   * How many wrong guesses my team (or, in solo mode, just me) has made so
   * far this game — shown alongside the shared cooldown so a teammate whose
   * own phone never touched the keypad still understands why it's resetting.
   */
  teamAttempts: number;
  /**
   * Everyone's ruthless tally, opened at the tribunal — same phase gate as
   * `standings`, and null before it for the same reason. Your own tally is
   * NOT here: it's computed client-side from your own `answers`, which are
   * always visible to you, exactly like `standings` doesn't duplicate your
   * own `myScores`.
   */
  ruthless: { playerId: string; name: string; marks: number; disqualified: boolean }[] | null;
  /** The extraction code itself, plus its plain-English recipe. Refused before `result` — that refusal is the seal. */
  keyReveal: { code: string; recipe: string } | null;
  /**
   * Your own team, including you — null in solo mode, or before teams are
   * assigned (at the lobby). Just IDs: `Player.name` already tells you who's
   * who, and this is not a secret, so no separate name list is worth keeping
   * in sync with it.
   */
  myTeam: string[] | null;
}

/** Letters are how the host reads a move aloud, so they live in one place. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * Your survival rate across every question you have a figure for — the
 * geometric mean of each round's chance, not their arithmetic average.
 *
 * A round's percentage is the chance you make it through THAT round alone,
 * and the chance of several independent things all going your way is their
 * product, not their sum — 75% and then 70% is a 52.5% chance of both, not a
 * 72.5% chance of "one of them, on average." A plain arithmetic mean would
 * lose that: it cannot fall as the night goes on no matter how bad your calls
 * get, which contradicts the entire premise of the game.
 *
 * The raw product still does the right thing mathematically, but it does the
 * wrong thing on screen: nine rounds compounded together crush BOTH a
 * near-perfect run and a middling one down toward the same unreadable "1%",
 * because multiplying nine numbers under 1 shrinks fast regardless of how
 * good they are. Taking the Nth root undoes exactly that shrinkage — it asks
 * "what single steady per-round rate would have produced this same product?"
 * — which rescales the number back onto a legible 0-100 scale without
 * touching its meaning: the Nth root is a strictly increasing function of the
 * product, so every ranking and every tie-break that depends on relative
 * order (see `survivalOddsPrecise`) comes out exactly the same either way.
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
 * The same geometric mean, unrounded — for comparing two players, never for
 * display.
 *
 * Rescaling by the Nth root spreads odds across a legible range instead of
 * crushing everyone near zero, but two precise values can still land on the
 * same rounded display by coincidence (e.g. two-round runs of [64, 64] and
 * [63, 65] both round to "64.0%"). A tie-break or a ranking decided on the
 * rounded figure would call that an honest tie when it is not one. Compare on
 * this instead, and round only the number a human actually reads.
 */
export function survivalOddsPrecise(scores: MyScore[]): number | null {
  if (scores.length === 0) return null;
  const product = scores.reduce((odds, s) => odds * (s.survivalPct / 100), 1);
  return Math.pow(product, 1 / scores.length) * 100;
}
