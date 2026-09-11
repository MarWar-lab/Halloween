/**
 * Core game vocabulary. Everything else in the app is built on these types.
 *
 * The engine is theme-agnostic: a Card knows its mechanic and its heat, never
 * that it is a Halloween card. Themes supply the words the players actually see
 * (see themes.ts) so the same deck structure runs a graveyard séance in October
 * and a normal campfire in March.
 */

/**
 * How hot a card runs — the courage dial. Two settings, not three: warm up,
 * then commit. A third step made the difference between any two neighbouring
 * levels too small to feel, and stretched the night past the time it has.
 */
export type Heat = 1 | 2;

/**
 * What the card asks of a player.
 *
 * - `solo`     one player is up; everyone else scores the performance
 * - `allplay`  everyone answers privately, answers reveal unattributed, all vote
 * - `guesswho` everyone submits a private fact; the group guesses whose it is
 * - `duel`     two players, one prompt, the room picks a winner
 * - `split`    two options, one tap, the room divides in half
 * - `poll`     tap a person; the count of names is the answer
 *
 * `split` exists because every other mechanic asks a player to write or to
 * perform, and a third of any team will do neither. Tapping one of two words
 * takes three seconds, exposes nobody, and still produces a real answer from
 * everyone in the room at once.
 */
export type Mechanic = 'solo' | 'allplay' | 'guesswho' | 'duel' | 'split' | 'poll';

/**
 * Solo cards come in two lanes — the "Trick or Truth" choice. `say` is answered
 * with words, `do` requires an action. Themes rename them (see Theme.vocab).
 * Non-solo mechanics are always `say`.
 */
export type Lane = 'say' | 'do';

export interface Card {
  id: string;
  /** Deck this card belongs to; set by the deck module, not hand-written. */
  deck: string;
  mechanic: Mechanic;
  lane: Lane;
  heat: Heat;
  /** Short name shown large on the Stage. */
  title: string;
  /** The line the host reads aloud, and the text shown to the player. */
  prompt: string;
  /** Placeholder for the answer box on submit-based mechanics. */
  submitHint?: string;
  /** One line on how the card is won — shown under the prompt. */
  wins: string;
  /**
   * `split` only: the two things being chosen between. Kept to two — three
   * options is a survey, two is an argument.
   */
  options?: [string, string];
  /** Timer length in seconds. */
  secs: number;
  /**
   * True when the card cannot be played without a personal device (typing a
   * private answer). Every heat level must retain enough `false` cards to run a
   * whole game on the host's screen alone — see deckIsPlayableWithoutDevices().
   */
  needsDevice: boolean;
  tags?: string[];
}

export interface Deck {
  id: string;
  name: string;
  /** One line shown when picking a deck in the lobby. */
  blurb: string;
  cards: Card[];
}

/** The big phases of an evening. Heat climbs across them, never back down. */
export type GamePhase =
  | 'lobby'
  | 'briefing'
  | 'warmup'
  | 'round1'
  | 'intermission'
  | 'round2'
  | 'finale'
  | 'awards';

/** The sub-phases within a single card being played. */
export type RoundPhase =
  | 'choosing' // solo only: the player picks their lane
  | 'performing' // the timer is running
  | 'submitting' // private answers are being written
  | 'revealing' // answers shown one at a time, unattributed
  | 'voting'
  | 'scored';

export interface CharacterLook {
  /** Base body colour index into the theme's body palette. */
  body: number;
  /** Head-topper: hair style or hat, index into the theme's topper set. */
  topper: number;
  /** Clothing colour index. */
  top: number;
  /** Optional accessory index; -1 for none. */
  accessory: number;
}

export interface Player {
  id: string;
  gameId: string;
  /** Supabase auth uid. Null for proxy players, who have no device. */
  userId: string | null;
  name: string;
  look: CharacterLook;
  isProxy: boolean;
  /** For proxies: the player id of the host operating them. */
  controlledBy: string | null;
  score: number;
  passSpent: boolean;
  lastSeen: string;
}

export interface Round {
  id: string;
  gameId: string;
  idx: number;
  cardId: string;
  mechanic: Mechanic;
  /** The player up on a solo turn; the challenger on a duel. */
  turnPlayerId: string | null;
  /** The second player on a duel. */
  opponentId: string | null;
  phase: RoundPhase;
  /** Server-set absolute deadline. Clients render against their clock offset. */
  deadlineAt: string | null;
  results: RoundResults | null;
}

export interface Game {
  id: string;
  code: string;
  hostUserId: string;
  deckId: string;
  themeId: string;
  phase: GamePhase;
  roundNo: number;
  heatCap: Heat;
  createdAt: string;
}

export interface Submission {
  id: string;
  roundId: string;
  /**
   * Null for other people's answers until the round is scored.
   *
   * This is the anonymity the all-play and guess-who mechanics are built on,
   * and it has to be enforced where the data is produced, not where it is
   * displayed — an author id that reaches the browser has already leaked,
   * whatever the component chooses to render.
   */
  playerId: string | null;
  text: string;
  createdAt: string;
}

export interface Vote {
  id: string;
  roundId: string;
  voterId: string;
  /**
   * allplay/guesswho: the answer being voted on. Voters pick an answer, never
   * a person — they are not told whose it is.
   */
  submissionId: string | null;
  /**
   * Who the vote resolves to. Set by the server from `submissionId`, so a
   * client cannot learn an author by reading back its own vote.
   */
  targetPlayerId: string | null;
  /** solo: 1-5 performance score. */
  score: number | null;
  /** split: which of the card's two options, 0 or 1. */
  optionIndex: number | null;
  /** guesswho: who they think wrote it. */
  guessPlayerId: string | null;
}

/** Per-player points awarded by a round, plus anything the awards screen needs. */
export interface RoundResults {
  points: Record<string, number>;
  /** allplay: submission id → author, revealed once scored. */
  authors?: Record<string, string>;
  /** Free-form notes the Stage can show ("fooled 6 people"). */
  notes?: Record<string, string>;
}
