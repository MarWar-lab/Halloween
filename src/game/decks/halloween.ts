/**
 * The Halloween season pack — Campfire's launch deck.
 *
 * Deck design rules, applied throughout:
 *
 * 1. Heat 1 must be genuinely funny, not a consolation prize. A player who
 *    never leaves heat 1 should be able to win the night.
 * 2. Every heat level keeps enough `needsDevice: false` cards to run a whole
 *    game on the host's shared screen alone (checked by a unit test).
 * 3. Prompts are written in the host's voice: solemn, administrative, deadpan.
 *    The comedy is in treating "draw a monster in MS Paint" as due process.
 * 4. Nothing asks a player to disclose anything a colleague could hold against
 *    them. Heat 3 is exposing in the sense of *silly*, never of *personal*.
 */

import type { Card, Deck } from '../types';

type CardSeed = Omit<Card, 'deck'>;

const cards: CardSeed[] = [
  // ─── ALL-PLAY ─────────────────────────────────────────────────────────────
  // Everyone answers privately, answers reveal unattributed, everyone votes.
  // This is the mechanic that lets the quietest person on the call win a round
  // without unmuting or being looked at.
  {
    id: 'ghost-writer',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Ghost Writer',
    prompt:
      'Write a two-sentence horror story. The first sentence sets it up. The second one ruins your evening.',
    submitHint: 'Two sentences. That is the whole form.',
    wins: 'Answers are read out unattributed. Vote for the one that got you.',
    secs: 180,
    needsDevice: true,
    tags: ['writing', 'warmup'],
  },
  {
    id: 'group-seance',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Group Séance',
    prompt:
      'What would your ghost haunt? Not where — what. A building, an object, one specific recurring meeting.',
    submitHint: 'One line.',
    wins: 'Most votes takes it. Specificity beats scale.',
    secs: 90,
    needsDevice: true,
  },
  {
    id: 'small-terrors',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Small Terrors',
    prompt:
      'Name one completely mundane thing that terrified you as a child. Not ghosts. The vacuum cleaner. A specific advert. The drain.',
    submitHint: 'The more ordinary, the better.',
    wins: 'Votes go to the fear that at least two other people also secretly had.',
    secs: 90,
    needsDevice: true,
  },
  {
    id: 'candy-court',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Candy Court',
    prompt: 'State your most indefensible autumn opinion, and defend it in exactly one sentence.',
    submitHint: 'One sentence. No hedging.',
    wins: 'Vote for the opinion you most want to see prosecuted.',
    secs: 90,
    needsDevice: true,
  },
  {
    id: 'superstition-audit',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Superstition Audit',
    prompt: 'Name one superstition you do not believe in and still obey anyway.',
    submitHint: 'Bonus if you did it this week.',
    wins: 'Votes for the most committed hypocrisy.',
    secs: 75,
    needsDevice: true,
  },
  {
    id: 'unmarked-file',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Unmarked File',
    prompt:
      'What is the oldest object within arm’s reach of you right now, and how long has it been there?',
    submitHint: 'Age, and what it is. If you do not know what it is, say that.',
    wins: 'Anything over two years old with no known purpose is hard to beat.',
    secs: 75,
    needsDevice: true,
  },
  {
    id: 'last-words',
    mechanic: 'allplay',
    lane: 'say',
    heat: 2,
    title: 'Last Words',
    prompt:
      'You are a minor character in a horror film. Write the line you say immediately before it happens.',
    submitHint: 'One line of dialogue.',
    wins: 'Vote for the line that most deserved what followed.',
    secs: 90,
    needsDevice: true,
  },
  {
    id: 'the-curse',
    mechanic: 'allplay',
    lane: 'say',
    heat: 2,
    title: 'The Curse',
    prompt:
      'Invent a curse mild enough to be legal and specific enough to ruin one working day.',
    submitHint: 'Petty. Precise. Survivable.',
    wins: 'Most votes. Petty beats apocalyptic every time.',
    secs: 120,
    needsDevice: true,
  },
  {
    id: 'warning-label',
    mechanic: 'allplay',
    lane: 'say',
    heat: 2,
    title: 'Warning Label',
    prompt:
      'You are a haunted object in a museum. Write the small printed card the museum puts beside you.',
    submitHint: 'Include what visitors must not do.',
    wins: 'Vote for the object you would least want in your house.',
    secs: 120,
    needsDevice: true,
  },

  // ─── GUESS-WHO ────────────────────────────────────────────────────────────
  // A private fact, then the group guesses the author. Warm, zero performance,
  // and it teaches the team something true about each other.
  {
    id: 'first-costume',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 1,
    title: 'First Costume',
    prompt: 'Describe the best costume you ever wore — without naming what it was.',
    submitHint: 'Describe it so we can see it. Do not say what it is.',
    wins: 'Two points for guessing an author. One point to you for everyone you fool.',
    secs: 120,
    needsDevice: true,
  },
  {
    id: 'skeleton-key',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 2,
    title: 'Skeleton Key',
    prompt:
      'One thing about you that nobody on this call could possibly work out from your calendar.',
    submitHint: 'True, and genuinely unguessable.',
    wins: 'Guess the author for two points. Fool someone and take one.',
    secs: 120,
    needsDevice: true,
  },
  {
    id: 'the-glitch',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 2,
    title: 'The Glitch',
    prompt:
      'The closest you have come to something you genuinely could not explain. You are allowed an unsatisfying ending.',
    submitHint: 'Short. Unresolved is fine.',
    wins: 'Guess the author for two points. Fool someone and take one.',
    secs: 150,
    needsDevice: true,
  },
  {
    id: 'the-house',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 2,
    title: 'The House',
    prompt:
      'Describe one room of a home you lived in before you were twelve — precisely enough that we can see it.',
    submitHint: 'One smell, one sound, one texture.',
    wins: 'Guess the author for two points. Fool someone and take one.',
    secs: 150,
    needsDevice: true,
  },
  {
    id: 'statute-of-limitations',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 3,
    title: 'Statute of Limitations',
    prompt:
      'A work mistake you got away with. It must be old enough that nobody can do anything about it.',
    submitHint: 'Expired only. Nothing live.',
    wins: 'Guess the author for two points. Fool someone and take one.',
    secs: 150,
    needsDevice: true,
  },

  // ─── SOLO · SAY ───────────────────────────────────────────────────────────
  // Spoken answers. No typing, so these keep heat 1 playable device-free.
  {
    id: 'the-nightlight',
    mechanic: 'solo',
    lane: 'say',
    heat: 1,
    title: 'The Nightlight',
    prompt:
      'What did you need in the room to fall asleep as a child? The door ajar, a specific toy, a particular arrangement of blankets. Tell us.',
    wins: 'Scored 1-5 by everyone else. Points for the most elaborate protective ritual.',
    secs: 60,
    needsDevice: false,
  },
  {
    id: 'the-sound',
    mechanic: 'solo',
    lane: 'say',
    heat: 1,
    title: 'The Sound',
    prompt: 'Describe a sound that still makes you flinch, and make the sound for us.',
    wins: 'Scored 1-5. Commitment to the sound effect beats accuracy.',
    secs: 45,
    needsDevice: false,
  },
  {
    id: 'unlucky-object',
    mechanic: 'solo',
    lane: 'say',
    heat: 1,
    title: 'The Unlucky Object',
    prompt: 'Tell us about the unluckiest object you own, and what it has done to you.',
    wins: 'Scored 1-5. Evidence of a pattern scores highest.',
    secs: 60,
    needsDevice: false,
  },
  {
    id: 'three-knocks',
    mechanic: 'solo',
    lane: 'say',
    heat: 2,
    title: 'Three Knocks',
    prompt:
      'Something knocks three times at your door tonight. Talk us through exactly what you do, in order, for the next five minutes.',
    wins: 'Scored 1-5. Points for a plan detailed enough to be genuinely worrying.',
    secs: 90,
    needsDevice: false,
  },

  // ─── SOLO · DO ────────────────────────────────────────────────────────────
  {
    id: 'ms-paint-monster',
    mechanic: 'solo',
    lane: 'do',
    heat: 1,
    title: 'MS Paint Monster',
    prompt:
      'Cameras off. Ninety seconds. Open any drawing tool and draw the monster that lives in your building. Then hold it up.',
    wins: 'Scored 1-5 on menace per pixel. Mouse-drawn beats stylus-drawn on principle.',
    secs: 90,
    needsDevice: false,
  },
  {
    id: 'the-camouflage',
    mechanic: 'solo',
    lane: 'do',
    heat: 1,
    title: 'The Camouflage',
    prompt:
      'Sixty seconds. Find an image and set it as your video background so that it camouflages the shirt you are wearing right now.',
    wins: 'Scored 1-5. A floating head scores. A floating head and one hand scores more.',
    secs: 60,
    needsDevice: false,
  },
  {
    id: 'rename-ritual',
    mechanic: 'solo',
    lane: 'do',
    heat: 1,
    title: 'Rename Ritual',
    prompt:
      'Change your display name to your horror-movie character and their fate. "Ana — dies first, has the map." You keep it for the rest of the night.',
    wins: 'Scored 1-5. Everyone lives with your name for ninety minutes, so make it count.',
    secs: 45,
    needsDevice: false,
  },
  {
    id: 'frankensteins-snack',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: "Frankenstein's Snack",
    prompt:
      'Three minutes. Build the most alarming edible thing you can from exactly three items in your kitchen. You must take one bite on camera.',
    wins: 'Scored 1-5. Refusing your own creation forfeits the round entirely.',
    secs: 180,
    needsDevice: false,
  },
  {
    id: 'witches-brew',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: "Witch's Brew",
    prompt:
      'Without leaving your seat: combine three liquids within arm’s reach into one glass, and give the result a name.',
    wins: 'Scored 1-5 on colour and name. You do not have to drink it. We would prefer you did not.',
    secs: 90,
    needsDevice: false,
  },
  {
    id: 'seance-line',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: 'The Séance Line',
    prompt:
      'Two minutes. Conduct a serious, respectful interview with a household appliance about its afterlife.',
    wins: 'Scored 1-5 on gravity. Any laughing from you and the spirit departs.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'the-entrance',
    mechanic: 'solo',
    lane: 'do',
    heat: 3,
    title: 'The Entrance',
    prompt:
      'Leave the frame. You have one minute to prepare. Return with the most dramatic entrance you can physically manage.',
    wins: 'Scored 1-5. Sound effects made with your own mouth are worth double.',
    secs: 60,
    needsDevice: false,
  },
  {
    id: 'desk-cinema',
    mechanic: 'solo',
    lane: 'do',
    heat: 3,
    title: 'Desk Cinema',
    prompt:
      'Two minutes. Recreate an iconic horror scene using only what is currently on your desk, then hold the final tableau.',
    wins: 'Scored 1-5. Bonus in spirit if the room guesses the film.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'final-girl',
    mechanic: 'solo',
    lane: 'do',
    heat: 3,
    title: 'Final Girl',
    prompt:
      'Ninety seconds to write four rhyming lines on exactly why you would be the last one alive. Then read them aloud, with feeling.',
    wins: 'Scored 1-5, with everything riding on a rhyme that should not have worked.',
    secs: 90,
    needsDevice: false,
  },

  // ─── DUELS ────────────────────────────────────────────────────────────────
  // Two players, one prompt, the room picks. Saved for the finale so the night
  // ends on a peak instead of trailing off.
  {
    id: 'duel-artifact',
    mechanic: 'duel',
    lane: 'do',
    heat: 2,
    title: 'Pitch-Off: The Artifact',
    prompt:
      'Both of you: fetch one object. You each have forty-five seconds to convince the room that yours is the more dangerous cursed artifact.',
    wins: 'The room votes. Three points to the winner, one for turning up.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'duel-survival',
    mechanic: 'duel',
    lane: 'say',
    heat: 2,
    title: 'Who Outlives Whom',
    prompt:
      'You are both in the same horror film. Thirty seconds each to argue why you outlive the other one.',
    wins: 'The room votes. Three points to the survivor.',
    secs: 90,
    needsDevice: false,
  },
  {
    id: 'duel-haunting',
    mechanic: 'duel',
    lane: 'say',
    heat: 3,
    title: 'Two Ghosts Enter',
    prompt:
      'You have both died and elected to haunt this company. Forty-five seconds each on precisely how you would do it.',
    wins: 'The room votes for the haunting it would least like to work through.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'duel-scream',
    mechanic: 'duel',
    lane: 'do',
    heat: 3,
    title: 'The Scream-Off',
    prompt:
      'One scream each. You may set it up with context first. Mind your neighbours and your microphone gain.',
    wins: 'The room votes. Three points to the scream that landed.',
    secs: 60,
    needsDevice: false,
  },
  // ─── ALL-PLAY, ADDED IN THE REBALANCE ─────────────────────────────────────
  // More than half this deck used to be `solo` — the one mechanic that puts a
  // single person on the spot. That is the wrong shape for a work party: the
  // people who most need a way in were the ones being singled out. These are
  // all everyone-at-once, answered privately, revealed with no name attached.
  {
    id: 'the-supply',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Supply',
    prompt:
      'What is in the house for callers tonight — and how much of it have you already eaten?',
    submitHint: 'Both halves. The second half is the interesting one.',
    wins: 'Votes for the most honest arithmetic.',
    secs: 90,
    needsDevice: true,
    tags: ['warmup', 'confession'],
  },
  {
    id: 'the-rewatch',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Rewatch',
    prompt:
      'The film you put on every single year without anyone asking you to. Irony is not permitted.',
    submitHint: 'Title only. No defending it.',
    wins: 'Votes for the pick the room most agrees is correct.',
    secs: 60,
    needsDevice: true,
    tags: ['warmup', 'film'],
  },
  {
    id: 'the-statement',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'For The Record',
    prompt: 'Complete the statement: “If it is pumpkin spice, I am ______.”',
    submitHint: 'One clause. Under oath.',
    wins: 'Votes for the position most worth holding.',
    secs: 60,
    needsDevice: true,
    tags: ['warmup'],
  },
  {
    id: 'hero-or-villain',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Hero or Villain',
    prompt: 'Pick one. Then justify it in under ten words.',
    submitHint: 'The word, then the defence.',
    wins: 'Votes for the shortest convincing argument.',
    secs: 60,
    needsDevice: true,
    tags: ['warmup', 'fast'],
  },
  {
    id: 'the-attic',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Something Upstairs',
    prompt: 'You hear movement above you, and you live alone. State your next action in five words.',
    submitHint: 'Five words. Count them.',
    wins: 'Votes for the plan the room would actually follow.',
    secs: 60,
    needsDevice: true,
    tags: ['warmup', 'fast'],
  },
  {
    id: 'discontinued',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Discontinued',
    prompt:
      'Name the confectionery that should be withdrawn from sale, and submit one line of evidence.',
    submitHint: 'The item, then the charge against it.',
    wins: 'Votes for the prosecution the room would convict on.',
    secs: 90,
    needsDevice: true,
    tags: ['warmup', 'opinion'],
  },
  {
    id: 'most-likely',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Most Likely To',
    prompt:
      'Which of us has decorated the most of their house this month? One name. No commentary.',
    submitHint: 'A name. Nothing else.',
    wins: 'The name that comes up most is read out last.',
    secs: 45,
    needsDevice: true,
    tags: ['warmup', 'team'],
  },
  {
    id: 'witch-name',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Registered Witch',
    prompt: 'State your witch name and the one narrow domain you are the witch of.',
    submitHint: 'Name, then jurisdiction.',
    wins: 'Votes for the jurisdiction the room most wants to see enforced.',
    secs: 90,
    needsDevice: true,
    tags: ['invention'],
  },
  {
    id: 'misunderstood',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'The Wronged Party',
    prompt: 'On the evidence, which monster is actually the victim here? One sentence for the defence.',
    submitHint: 'Name the client, then the case.',
    wins: 'Votes for the acquittal the room believes.',
    secs: 90,
    needsDevice: true,
    tags: ['opinion'],
  },
  {
    id: 'unseen',
    mechanic: 'allplay',
    lane: 'say',
    heat: 1,
    title: 'Shown or Not Shown',
    prompt:
      'Worse: the thing the film shows you, or the thing it never does? One line of argument.',
    submitHint: 'Pick a side first.',
    wins: 'Votes for the argument that changes a mind.',
    secs: 90,
    needsDevice: true,
    tags: ['film', 'opinion'],
  },
  {
    id: 'twenty-minutes',
    mechanic: 'allplay',
    lane: 'say',
    heat: 2,
    title: 'Twenty Minutes',
    prompt:
      'You have twenty minutes and only what is in the room you are sitting in. Describe the costume.',
    submitHint: 'Name the materials. That is where the comedy is.',
    wins: 'Votes for the one the room would most like to see attempted.',
    secs: 120,
    needsDevice: true,
    tags: ['invention'],
  },
  {
    id: 'the-title',
    mechanic: 'allplay',
    lane: 'say',
    heat: 2,
    title: 'Now A Major Release',
    prompt: 'Your last twelve months, released as a horror film. Give us the title only.',
    submitHint: 'A title. No synopsis.',
    wins: 'Votes for the one that needs no synopsis.',
    secs: 90,
    needsDevice: true,
    tags: ['invention'],
  },

  // ─── GUESS-WHO, ADDED ─────────────────────────────────────────────────────
  {
    id: 'the-retirement',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 1,
    title: 'The Retirement',
    prompt: 'The age you stopped knocking on doors, and the thing that finally stopped you.',
    submitHint: 'An age and a reason.',
    wins: 'Two points for each author you name. One point for everyone you fool.',
    secs: 90,
    needsDevice: true,
    tags: ['nostalgia'],
  },
  {
    id: 'the-haul',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 2,
    title: 'The Haul',
    prompt: 'The best thing you were ever handed at a door, and the worst. Both, briefly.',
    submitHint: 'Best first, worst second.',
    wins: 'Two points for each author you name. One point for everyone you fool.',
    secs: 90,
    needsDevice: true,
    tags: ['nostalgia'],
  },
  {
    id: 'the-tradition',
    mechanic: 'guesswho',
    lane: 'say',
    heat: 1,
    title: 'The Tradition',
    prompt:
      'One thing you do at this time every year that sounds strange the moment it is said out loud.',
    submitHint: 'Describe it flatly. Flat is funnier.',
    wins: 'Two points for each author you name. One point for everyone you fool.',
    secs: 90,
    needsDevice: true,
    tags: ['confession'],
  },

  // ─── DUEL, ADDED ──────────────────────────────────────────────────────────
  {
    id: 'duel-costume',
    mechanic: 'duel',
    lane: 'do',
    heat: 2,
    title: 'Twenty Minutes: Head To Head',
    prompt:
      'Thirty seconds each. Talk the room into your last-minute costume, built from what is in your room right now. You may hold things up.',
    wins: 'The room votes. Three to the winner, one each for turning up.',
    secs: 30,
    needsDevice: false,
    tags: ['finale'],
  },
];

export const halloween: Deck = {
  id: 'halloween',
  name: 'Trick or Truth',
  blurb: 'The Halloween season pack. Séances, cursed desk objects, and a scream-off finale.',
  cards: cards.map((c) => ({ ...c, deck: 'halloween' })),
};
