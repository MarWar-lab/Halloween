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

/** "Warm-up 1 of 2" while idx is negative, "Question 1 of 7" once it isn't. */
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

/** The eighth question, which is answered in words rather than by choosing. */
export const FINAL_PLEA = {
  title: 'The Final Plea',
  setup:
    'The chopper lands. The blast doors give way. There is one seat left, and the ' +
    'pilot is shouting over the rotors: we are over the weight limit, and I can take ' +
    'one of you. Give me one good reason why it should be YOU.',
  /** One sentence. The cap is the form, not a technical limit. */
  maxChars: 150,
};

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
  },
];
