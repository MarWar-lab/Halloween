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
    id: 'last-fright',
    mechanic: 'solo',
    lane: 'say',
    heat: 2,
    title: 'The Last Fright',
    prompt:
      'What is the last thing that actually frightened you? Not a film. Real life. Forty-five seconds.',
    wins: 'Scored 1-5. A quiet answer that lands beats a loud one that does not.',
    secs: 45,
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
  {
    id: 'read-my-palm',
    mechanic: 'solo',
    lane: 'say',
    heat: 3,
    title: 'Read My Palm',
    prompt:
      'Name one decision you are currently avoiding. Lunch, a haircut, a life change — entirely your call how big.',
    wins: 'The room gives you a one-line reading for it. Then everyone scores the readings, not you. You are safe here.',
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
    id: 'the-eyes',
    mechanic: 'solo',
    lane: 'do',
    heat: 1,
    title: 'The Eyes',
    prompt:
      'Count everything in your room that has eyes. Posters, toys, book covers, pets, that one mug. Sixty seconds.',
    wins: 'Scored 1-5, but you must show us the three creepiest to claim your number.',
    secs: 60,
    needsDevice: false,
  },
  {
    id: 'cursed-cursor',
    mechanic: 'solo',
    lane: 'do',
    heat: 1,
    title: 'Cursed Cursor',
    prompt:
      'Share your desktop. Nothing confidential, nothing open — wallpaper and folders only. We are looking for the most haunted thing on it.',
    wins: 'Scored 1-5. "final_FINAL_v3_use_this_one" is the benchmark. Beat it.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'cursed-object',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: 'The Cursed Object',
    prompt:
      'Sixty seconds to fetch the strangest object within reach. Thirty seconds to pitch it to us as a genuinely dangerous artifact.',
    wins: 'Scored 1-5 on the origin story. The object matters less than the confidence.',
    secs: 90,
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
    id: 'the-poltergeist',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: 'The Poltergeist',
    prompt:
      'Two minutes. Stack as many household objects as you can into one freestanding tower. It must survive five seconds unaided.',
    wins: 'Scored 1-5 on the standing tower. A collapse on camera still earns sympathy points.',
    secs: 120,
    needsDevice: false,
  },
  {
    id: 'doppelganger',
    mechanic: 'solo',
    lane: 'do',
    heat: 2,
    title: 'Doppelgänger',
    prompt:
      'Ninety seconds. Find an inanimate object in your home that looks exactly like you do today. Hold it next to your face.',
    wins: 'Scored 1-5 on resemblance. The room is cruel and that is the point.',
    secs: 90,
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
    id: 'the-mummy',
    mechanic: 'solo',
    lane: 'do',
    heat: 3,
    title: 'The Mummy',
    prompt:
      'Three minutes. Mummify yourself using only office supplies and whatever is in your bathroom. You must remain able to see.',
    wins: 'Scored 1-5. Toilet roll is obvious and therefore scores lowest. Be inventive.',
    secs: 180,
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
];

export const halloween: Deck = {
  id: 'halloween',
  name: 'Trick or Truth',
  blurb: 'The Halloween season pack. Séances, cursed desk objects, and a scream-off finale.',
  cards: cards.map((c) => ({ ...c, deck: 'halloween' })),
};
