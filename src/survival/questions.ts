/**
 * The Last Screen Standing — everything the players are allowed to read.
 *
 * Setups and the five labels per question, and nothing else. The percentages
 * and the outcome prose are NOT here and must never be: they live in the
 * survival_options table, behind a security-definer function, because a deck
 * in the bundle is a deck anybody can open.
 *
 * See src/survival/sealed.ts for the one deliberate exception and why it is
 * not really one.
 *
 * This file also carries two things that look like they should be secrets
 * and are not: `DARK_CHOICES` (which options are "ruthless") and each
 * question's `manifest` metadata (which round carries a real clue vs. a
 * decoy, and which berth it claims). Both are inferable from the choice text
 * and the read-aloud narration anyway — a player who pays attention already
 * knows them. The one genuine secret in the whole puzzle is the per-game
 * random *digit* at each clued round, which lives in the database behind
 * `survival_clue_digits`/`survival_keys` and is never bundled here.
 */

export interface Question {
  title: string;
  /** What the host reads aloud. */
  setup: string;
  /**
   * The five moves, in the order every screen letters them A-E.
   *
   * Ordered as written, never sorted, never grouped, never marked. Nothing
   * about how these are presented may suggest which one is survivable — that
   * hint is the only thing the seal exists to withhold.
   */
  choices: [string, string, string, string, string];
  /**
   * Warm-up questions only: a line of flavour per choice, read at the reveal.
   * There is no percentage attached and nothing here is a secret — a warm-up
   * has nothing for the seal to protect, so its "outcome" lives in the open,
   * right next to the choice it belongs to, rather than behind the RPC that
   * guards a real question's `SEALED` entry.
   */
  outcomes?: [string, string, string, string, string];
  /**
   * A public asset path, e.g. '/clips/checkpoint.mp4'. A video is not a
   * secret, so — unlike everything in sealed.ts — this lives right here next
   * to the question it belongs to. Only four of nine questions have one:
   * forcing a mismatched clip onto a question with no matching footage would
   * be worse than showing nothing.
   */
  clip?: string;
  /**
   * The extraction-manifest clue this round carries, if any (7 of the 9 real
   * questions do; two carry nothing to read at all, on purpose). `berth` and
   * `color` are fixed content, identical every game. `line` renders the
   * actual sentence once the per-game random digit for this round arrives
   * from the backend (`Snapshot.clue`) — before that, nothing is shown.
   */
  manifest?: {
    berth: 1 | 2 | 3 | 4;
    color: 'green' | 'red';
    /**
     * How the seal is obscured until a player deliberately reveals it — a
     * tap-and-look moment, not a passive read, the same "you had to be
     * paying attention in person" texture a photographed hidden-object clue
     * has. The digit itself is never in the DOM until revealed: this is a
     * placeholder-swap on tap, not a CSS blur someone could inspect around.
     */
    style: 'frost' | 'static' | 'torn';
    /**
     * Renders the line given whatever the caller wants shown where the seal
     * goes — the real digit as a string once revealed, or a placeholder
     * glyph before that. Takes a string, not the digit itself, so hiding it
     * is never a matter of redacting a number back out of already-composed
     * prose (fragile — a seal digit can equal the berth number elsewhere in
     * the same sentence).
     */
    line: (seal: string) => string;
  };
}

/**
 * Resolve whatever `question_idx` the game is currently on to the question it
 * names. The index can be negative (a warm-up, counting back from -1) or
 * 0..QUESTIONS.length-1 (a real question) — this is the one place that sign
 * is handled, so Player.tsx never has to think about it.
 */
export function questionAt(idx: number): Question {
  return idx < 0 ? INTRO_QUESTIONS[INTRO_QUESTIONS.length + idx] : QUESTIONS[idx];
}

/** "Warm-up 1 of 2" while idx is negative, "Question 1 of 9" once it isn't. */
export function questionLabel(idx: number): string {
  return idx < 0
    ? `Warm-up ${INTRO_QUESTIONS.length + idx + 1} of ${INTRO_QUESTIONS.length}`
    : `Question ${idx + 1} of ${QUESTIONS.length}`;
}

/** Read before the first question. */
export const OPENING =
  'The world ends on a Tuesday. A bio-digital virus — part organic disease, part ' +
  'corrupted smart-tech — is going through the city. The military are shutting down ' +
  'the grid and calling it a quarantine. You are at your desk at home. The last ' +
  'extraction chopper leaves the TWIN international trade port, on the far edge of ' +
  'the city, and you intend to be on it.';

/**
 * Read right after `OPENING`, before question one. States the entire
 * extraction-code mechanic in full — what a manifest line means, which way
 * the code reads, and that there is no lockout — on purpose: the only real
 * challenge is paying attention over the next nine rounds, never guessing
 * the rule itself.
 */
export const EXTRACTION_BRIEF =
  "TWIN publishes its berth manifest to the IOTA ledger, and the ledger doesn't " +
  'care that the grid is down — every screen you pass tonight will carry one line ' +
  'of it. A line reads berth N, seal D, plus a verdict: signed green (it counts) ' +
  'or red, rejected (ignore it). Berth is a position, 1 to 4. Once you have all ' +
  'four green seals, read them from berth 4 down to berth 1 — that is the code. ' +
  'Some rounds carry nothing to read at all. You get two tries at the keypad — ' +
  'a wrong one costs you a few seconds before the next — and if the second is ' +
  'wrong too, the port stops listening and it is the room who decides for you. ' +
  'Nobody is going to write any of this down for you.';

/** The keypad players use to try the extraction code, from round one onward. */
export const EXTRACTION = {
  /** Restated on the last round's reveal, as a reminder, never a reveal. */
  rule:
    'Last call. Four green seals, four berths. Read us the seals from the last ' +
    'berth back to the first.',
  prompt: 'State the code.',
  length: 4,
  /** How long a wrong guess costs you before the same player can try again. */
  retrySeconds: 5,
  /** Two wrong guesses and the keypad hands you to the room instead — nobody is stuck at a locked door all night. */
  maxWrongGuesses: 2,
};

/** The final round, which is answered in words rather than by choosing. */
export const FINAL_PLEA = {
  title: 'The Final Plea',
  setup:
    'The chopper lands. The blast doors give way. The pilot is shouting over the ' +
    'rotors: three seats, and I am already over the weight limit. Anyone who can ' +
    'state the extraction code walks on now. The rest of you argue it out. Give ' +
    'me one good reason why it should be YOU.',
  /** One sentence. The cap is the form, not a technical limit. */
  maxChars: 150,
};

/**
 * Setups now carry a functional payload on top of flavour — the same cap
 * `sealed.ts`'s `OUTCOME_MAX` applies to outcome prose, for the same reason:
 * it has to stay readable on a phone.
 */
export const SETUP_MAX = 340;

/**
 * Which options are "ruthless" — another named person is measurably worse
 * off because you picked it, not just selfishness (every option here is
 * selfish). Public on purpose: inferable from the choice text itself, and a
 * threshold nobody knows is a threshold nobody dreads.
 *
 * Indexed by `question_idx` (0..8); an empty array means that round has no
 * dark option at all.
 */
export const DARK_CHOICES: number[][] = [
  [2], // The Guilt Trip — block their number and barricade the door
  [2], // The Feuding Neighbour — golf club to the head, take the SUV
  [2, 4], // The Drive — speed off / let strangers fight for the seat
  [0], // The Checkpoint — shove a cougher into the AI scanner
  [2], // The Infiltration — take the hand with you for the scanners
  [2], // The Supply Cache — nothing, and lock the door behind you
  [1], // The Loading Dock — give them a decoy route instead
  [0], // The Dark Stairwell — trip the stranger running beside you
  [], // The Roof Breach — every option here only risks the player
];

/** A majority of the 8 rounds that carry a dark option — not reachable by an ordinary run of pragmatic picks, but real for anyone optimising blindly for survival percentage alone. */
export const RUTHLESS_LIMIT = 5;

/**
 * How many marks a player has earned — non-auto-assigned dark picks only.
 * An answer the game chose for you (silence, or a late-join backfill) never
 * counts: being disqualified for a choice you never made would be the one
 * genuinely unfair outcome this mechanic could produce.
 */
export function marksOf(
  answers: { playerId: string; questionIdx: number; optionIndex: number; autoAssigned: boolean }[],
  playerId: string,
): number {
  return answers.filter(
    (a) =>
      a.playerId === playerId &&
      !a.autoAssigned &&
      a.questionIdx >= 0 &&
      (DARK_CHOICES[a.questionIdx] ?? []).includes(a.optionIndex),
  ).length;
}

/**
 * Two icebreakers before the world ends in earnest. Zero stakes — no
 * `SEALED` entry exists for either of these, and none ever will: see
 * questions_idx's negative range in the migration for why that is a database
 * guarantee, not just a habit.
 */
export const INTRO_QUESTIONS: Question[] = [
  {
    title: 'First Move',
    setup:
      "Every phone in the house screams at once. Before anything else — what's the first thing you actually grab?",
    choices: [
      'Your charger',
      'The good snacks',
      'A family photo',
      'Your gaming console',
      'An umbrella, held like a weapon',
    ],
    outcomes: [
      'Priorities. The world can end; the battery cannot.',
      "Correct answer. Nobody is surviving an apocalypse on an empty stomach.",
      "Sentimental, and it's now taking up bag space you needed for water.",
      'Bold. There is, in fact, no wifi at the end of the world.',
      'It is, at minimum, a stick now.',
    ],
  },
  {
    title: 'The Group Chat',
    setup:
      "Your group chat has gone completely feral in the last four minutes. Be honest — which one are you?",
    choices: [
      'Posting memes about it',
      'Already live-streaming',
      'Panic-buying online',
      'Asking if this affects the match on Saturday',
      'Already left the chat',
    ],
    outcomes: [
      'The apocalypse waits for your punchline.',
      'Content is content.',
      'Fourteen tins of chickpeas, no can opener.',
      'It does. Everything does.',
      'The healthiest person in this scenario, frankly.',
    ],
  },
];

export const QUESTIONS: Question[] = [
  {
    title: 'The Guilt Trip',
    setup:
      'The emergency broadcast confirms the outbreak. Your phone rings. It is your sibling, downtown in the epicentre, hiding in a coffee shop and begging you to come and get them.',
    choices: [
      'Drive downtown and get them yourself',
      'Order them a $300 surge-price Uber Black',
      'Block their number and barricade the door',
      'Tell them to meet you halfway at the park',
      'Fly them a survival kit by drone',
    ],
    clip: '/clips/guilt-trip.mp4',
    manifest: {
      berth: 2,
      color: 'red',
      style: 'static',
      line: (seal) =>
        `A café screen behind them is still carrying the manifest: berth 2, seal ${seal} — red, rejected.`,
    },
  },
  {
    title: 'The Feuding Neighbour',
    setup:
      'Your street is overrun. Outside, the survivalist neighbour you cannot stand is loading an armoured SUV. “No room for your junk. It is either you, or my hundred-and-twenty-pound Rottweiler.”',
    choices: [
      'Offer your antibiotics for a seat',
      'Bribe them with a 2TB drive of films',
      'Golf club to the head, take the SUV',
      'Ditch your bag, ride beside the dog',
      'AirTag their bumper, follow on a bike',
    ],
    clip: '/clips/feuding-neighbour.mp4',
    manifest: {
      berth: 1,
      color: 'green',
      style: 'frost',
      line: (seal) =>
        `Their dashboard is still pulling the manifest off the ledger: berth 1, seal ${seal}, signed green.`,
    },
  },
  {
    title: 'The Drive',
    setup:
      'The road to the port is a crawl of brake lights. A family is banging on windows two cars over, begging anyone for room. You have exactly one open seat, and the gap in traffic will not stay open long.',
    choices: [
      'Open the door for the closest stranger',
      'Only take someone who can prove they are clean',
      'Speed up and pretend you did not see them',
      'Point them toward a bus you saw idling back',
      'Let them argue it out, take the winner',
    ],
    clip: '/clips/the-drive.mp4',
  },
  {
    title: 'The Checkpoint',
    setup:
      'The outer perimeter of the TWIN port. The military are scanning for bio-digital signatures, the line has stopped moving, and a riot is building at the back of it.',
    choices: [
      'Shove a cougher into the AI scanner',
      'Hi-vis vest, clipboard, walk briskly',
      'Wait in line and keep your head down',
      'Help the guard calm the crowd',
      'Crawl through the storm drain',
    ],
    clip: '/clips/checkpoint.mp4',
    manifest: {
      berth: 4,
      color: 'green',
      style: 'static',
      line: (seal) =>
        `The gate monitor cycles the manifest over and over: berth 4, seal ${seal}, signed green.`,
    },
  },
  {
    title: 'The Infiltration',
    setup:
      'You are inside the port, and the smart-gates into the secure logistics hub are locked down.',
    choices: [
      'A dead worker\'s ID on the IOTA terminal',
      'Type admin and password into the keypad',
      'Take the hand with you for the scanners',
      'Slip in behind an automated cargo truck',
      'Beg port authority over the comms box',
    ],
    clip: '/clips/infiltration.mp4',
    manifest: {
      berth: 4,
      color: 'red',
      style: 'torn',
      line: (seal) =>
        `A cracked terminal is still broadcasting: berth 4, seal ${seal} — red, rejected, overwritten.`,
    },
  },
  {
    title: 'The Supply Cache',
    setup:
      'A warehouse breakroom. Glass shatters down the hall — they are inside the building. There is time to take exactly one thing before the roof stairs.',
    choices: [
      'Water and high-calorie protein paste',
      'The industrial CO2 fire extinguisher',
      'Nothing, and lock the door behind you',
      'The trauma kit, for the injured outside',
      'A solar battery bank and a smart radio',
    ],
    clip: '/clips/supply-cache.mp4',
    manifest: {
      berth: 2,
      color: 'green',
      style: 'static',
      line: (seal) =>
        `A handheld radio reads the manifest into the empty room: berth 2, seal ${seal}, signed green.`,
    },
  },
  {
    title: 'The Loading Dock',
    setup:
      'Halfway across the dock, a survivor radio crackles to life on the ground. Someone else is out there, asking for the fastest way to the stairwell. Answering might get them there. It also tells anything listening exactly where you are.',
    choices: [
      'Give them the real route to the stairwell',
      'Give them a decoy route instead',
      'Stay silent and keep moving',
      'Answer, but lie about how close it is',
      'Smash the radio so you cannot answer again',
    ],
    clip: '/clips/loading-dock.mp4',
    manifest: {
      berth: 1,
      color: 'red',
      style: 'torn',
      line: (seal) => `The dock board above it holds one line: berth 1, seal ${seal} — red, rejected.`,
    },
  },
  {
    title: 'The Dark Stairwell',
    setup:
      'The grid fails. Thirty flights to the helipad in total darkness, with frantic movement echoing both above you and below you.',
    choices: [
      'Trip the stranger running beside you',
      'Throw loose change down the stairwell',
      'Shoes off, climb in total silence',
      'Hold your phone light up for the group',
      'Climb outside the railing, over the drop',
    ],
    clip: '/clips/dark-stairwell.mp4',
  },
  {
    title: 'The Roof Breach',
    setup:
      'The roof. The hydraulic blast doors are buckling behind you, and the extraction chopper is already on its approach.',
    choices: [
      'Smear yourself in infected blood',
      'Wrap up in a silver space blanket',
      'Push a generator against the door',
      'Stand at the door and hold them off',
      'Jam the door\'s hydraulic gears',
    ],
    clip: '/clips/roof-breach.mp4',
    manifest: {
      berth: 3,
      color: 'green',
      style: 'static',
      line: (seal) =>
        `The helipad's own panel writes its last line before the power goes: berth 3, seal ${seal}, signed green.`,
    },
  },
];
