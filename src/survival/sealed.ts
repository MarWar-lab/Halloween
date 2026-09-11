/**
 * The percentages and the outcome prose — a copy, for the local backend only.
 *
 * THIS IS NOT THE AUTHORITY. public.survival_options is, and
 * src/survival/seal.test.ts fails the build the moment these two disagree.
 *
 * A fair question: does keeping these in the bundle not defeat the seal? On
 * the real backend, no — nothing reads this file there. The percentages come
 * from a table with row-level security on, no policy and no grant, reachable
 * only through functions that run as the owner.
 *
 * On `?net=local` it defeats it completely, and that is stated rather than
 * worked around. That backend runs the entire game inside one browser with no
 * database at all, so it has no secrets to keep and cannot be given any.
 * Obfuscating these would cost real code and buy only the impression of
 * safety, which is worse than none. `?net=local` is for playing the game
 * through in several tabs before it is deployed. Play it for real on Supabase.
 */

export interface SealedOption {
  survivalPct: number;
  outcome: string;
}

/** Indexed by question, then by move. Mirrors the seed in the migration. */
export const SEALED: SealedOption[][] = [
  [
    {
      survivalPct: 45,
      outcome:
        'Driving into an epicentre is logistical suicide. You hit gridlock, abandon the car, and barely make it out on foot.',
    },
    {
      survivalPct: 60,
      outcome:
        'The gig economy provides. The driver picks them up, then drops them two blocks short of you at a military roadblock.',
    },
    {
      survivalPct: 75,
      outcome:
        'Utterly ruthless. You are physically safe behind your own door. Your soul is not. You survived. At what cost?',
    },
    {
      survivalPct: 50,
      outcome:
        'Moving targets are unpredictable. You both survive the rendezvous, and get to know a public restroom far better than planned.',
    },
    {
      survivalPct: 65,
      outcome:
        'Smart delegation. You stay safe, but a panicked survivor downs your drone with a rock before it ever reaches them.',
    },
  ],
  [
    {
      survivalPct: 50,
      outcome:
        'They take the deal, and they still hate you. Trading away critical medicine on day one is a debt that comes due later.',
    },
    {
      survivalPct: 70,
      outcome:
        'In an apocalypse, offline entertainment is the new gold. They take the drive gladly and let you keep your bag.',
    },
    {
      survivalPct: 45,
      outcome:
        'You get the car. You do not get the biometric kill-switch in the steering wheel, which stalls it a mile down the road.',
    },
    {
      survivalPct: 60,
      outcome:
        'A bumpy ride next to an aggressive Rottweiler earns you a deep bite on the arm that military scanners must never see.',
    },
    {
      survivalPct: 55,
      outcome:
        'Bicycles need no fuel and make no noise. The AirTag needs passing iPhones, and every phone in this city is already dead.',
    },
  ],
  [
    {
      survivalPct: 60,
      outcome:
        'The medical lockdown works and you slip out the side gate. The turrets almost track you. You are officially a villain.',
    },
    {
      survivalPct: 80,
      outcome:
        'Social engineering remains undefeated. Nobody in the history of security has ever stopped a man carrying a clipboard.',
    },
    {
      survivalPct: 70,
      outcome:
        'You clear the scanner seconds before the riot behind you breaches the perimeter. Boring, unheroic, and correct.',
    },
    {
      survivalPct: 55,
      outcome:
        'Noble. The crowd turns anyway, you go under it, and the guards drag you through the gate with a broken rib.',
    },
    {
      survivalPct: 50,
      outcome:
        'You bypass every guard and every scanner. The toxic runoff bypasses your skin and gives you a serious infection.',
    },
  ],
  [
    {
      survivalPct: 75,
      outcome:
        'The IOTA ledger logs your entry and the gate opens clean. Decentralised infrastructure does not care that the grid is down.',
    },
    {
      survivalPct: 65,
      outcome:
        'It works, proving IT negligence outlasts civilisation itself. It also trips a silent alarm you will hear about later.',
    },
    {
      survivalPct: 50,
      outcome:
        'Modern scanners check blood flow and pulse. Dead tissue reads as dead tissue, the gate refuses it, and the alarms start.',
    },
    {
      survivalPct: 80,
      outcome:
        'Patience pays. Zero contact, zero noise, zero trace. The safest way through a locked door is to let it open for someone else.',
    },
    {
      survivalPct: 55,
      outcome:
        'The AI denies your request. The shouting attracts everything nearby, and you go over razor wire in a considerable hurry.',
    },
  ],
  [
    {
      survivalPct: 75,
      outcome:
        'Hydration and calories are the whole foundation of staying alive. Boring, unglamorous, and very difficult to argue with.',
    },
    {
      survivalPct: 80,
      outcome:
        'Pragmatism wins. Sub-zero gas blinds anything in front of you, and it is a heavy metal club once the gas runs out.',
    },
    {
      survivalPct: 60,
      outcome:
        'You escape cleanly. The screaming you leave behind draws twice as many of them onto your floor.',
    },
    {
      survivalPct: 50,
      outcome:
        'You save a life in the hallway. Now there are two of you, with no food and no weapon, moving at half speed.',
    },
    {
      survivalPct: 55,
      outcome:
        'Information is comforting. A radio has never once stopped a set of teeth from closing on a forearm.',
    },
  ],
  [
    {
      survivalPct: 25,
      outcome:
        'You only have to outrun them, not the horde. They grab your ankle on the way down and take you with them.',
    },
    {
      survivalPct: 30,
      outcome:
        'The clatter pulls everything below you away. It also tells everything above you exactly which floor you are on.',
    },
    {
      survivalPct: 20,
      outcome:
        'You are genuinely silent. You are also barefoot on an exposed wire and broken glass, in absolute darkness.',
    },
    {
      survivalPct: 10,
      outcome:
        'You have made yourself the only bright object in a pitch-black shaft. They come to the light. All of them.',
    },
    {
      survivalPct: 15,
      outcome:
        'Your grip fails somewhere around the twenty-second floor. You vault back over the rail alive and completely spent.',
    },
  ],
  [
    {
      survivalPct: 15,
      outcome:
        'This is not that kind of virus. It tracks thermal signature, not smell. You have given yourself sepsis for nothing.',
    },
    {
      survivalPct: 30,
      outcome:
        'The foil scrambles their thermal read just enough. They stream straight past you toward the helipad.',
    },
    {
      survivalPct: 25,
      outcome:
        'Heavy machinery buys you a handful of breaths before the sheer mass of bodies shoves it aside.',
    },
    {
      survivalPct: 10,
      outcome:
        'Fifty bodies against one. Heroic, quotable, and over before the others have finished boarding.',
    },
    {
      survivalPct: 20,
      outcome:
        'The gears eat your weapon without slowing down, and the door opens exactly as it was always going to.',
    },
  ],
];

/**
 * The cap on outcome prose, asserted in the seal test.
 *
 * Five of these have to sit on a shared screen at 1366x768 without scrolling.
 * A limit enforced by a test is the only kind that survives contact with
 * somebody improving a joke.
 */
export const OUTCOME_MAX = 160;

/** The lowest-survival move on a question — what the game picks for you. */
export const worstOption = (questionIdx: number): number => {
  const moves = SEALED[questionIdx];
  let worst = 0;
  for (let i = 1; i < moves.length; i += 1) {
    if (moves[i].survivalPct < moves[worst].survivalPct) worst = i;
  }
  return worst;
};
