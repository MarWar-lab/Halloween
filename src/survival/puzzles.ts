/**
 * The extraction code, solved rather than handed out.
 *
 * A green berth's digit used to be *shown* to one player for one round, and
 * the whole challenge was remembering it and passing it on. That is
 * attention and memory; it is not problem solving, and it gave nobody a
 * reason to talk to anyone outside their own team.
 *
 * Now each green berth is a puzzle, and the digit is its answer. Every
 * player holds one fragment, and no single TEAM holds enough of them to
 * solve it — so assembling a berth means talking to somebody outside your
 * own team. `noTeamSolves` below is the property that makes that claim true
 * rather than aspirational, and puzzles.test.ts checks it over many seeded
 * generations.
 *
 * Note what is deliberately NOT required: that every fragment is needed. An
 * earlier draft of this generator made all of them necessary, which sounds
 * stronger and is much worse — it means one quiet or disconnected player
 * blocks the entire room from leaving. Redundancy is the feature. Four
 * fragments genuinely discriminate; the rest restate them, so a twenty
 * person room survives somebody going silent and a late arrival still holds
 * something worth trading.
 *
 * SIGNATURE CHECK, the first family: five candidate manifest lines, one
 * verification rule each. Exactly one line satisfies every rule in the room,
 * and its seal is the digit. It is the classic "everybody holds one clue"
 * format, it is genuine constraint satisfaction rather than arithmetic, and
 * thematically it is exactly what the fiction already describes — a ledger
 * whose entries you verify instead of trusting a single source.
 *
 * Nothing here is secret. The lines are public, the rules are public, and
 * the one thing that is not is WHICH rule a given player holds — which is
 * why fragments are dealt per player behind RLS rather than shipped with the
 * question. The answer is not derivable from any single fragment, so a
 * player reading their own row in devtools learns nothing.
 */

/** A line of the berth manifest, as everybody sees it. */
export interface ManifestLine {
  /** 1-based, and how the room refers to it out loud. */
  id: number;
  berth: number;
  /** 0-9. The seal on the line the rules single out is the answer. */
  seal: number;
  /** Minutes past midnight; rendered as HH:MM. */
  signedAt: number;
  signer: string;
}

/**
 * One player's fragment: a rule every valid line must satisfy.
 *
 * A closed set rather than a free-text predicate, so the same rule can be
 * evaluated in TypeScript, stored as a row, and rendered as a sentence
 * without three copies of the logic drifting apart.
 */
export type Rule =
  | { kind: 'sealParity'; even: boolean }
  | { kind: 'berthIs'; berth: number }
  | { kind: 'berthIsNot'; berth: number }
  | { kind: 'signedBefore'; minutes: number }
  | { kind: 'signedAfter'; minutes: number }
  | { kind: 'signerIs'; signer: string };

export interface Puzzle {
  /** Which green berth this puzzle unlocks. */
  berth: number;
  lines: ManifestLine[];
  /** One per player, in the order players were dealt them. */
  rules: Rule[];
  /**
   * Which of `rules` actually discriminate — at most four, one per decoy.
   * Every other rule restates one of these. Dropping a key rule leaves the
   * board ambiguous; dropping any other changes nothing, which is exactly
   * what lets a player go quiet without stranding the room.
   */
  keyRuleIndices: number[];
  /** The line every rule agrees on. Never sent to a client before `result`. */
  answerLineId: number;
}

/** A fragment as it is actually held: one rule, one player. */
export interface Fragment {
  playerId: string;
  rule: Rule;
  /** True for a rule that genuinely narrows the board. Not shown to players. */
  key: boolean;
}

const SIGNERS = ['HARBOURMASTER', 'PORT AUTHORITY', 'CUSTOMS', 'NIGHT CREW', 'TWIN CONTROL'];

/** Minutes past midnight → the HH:MM a manifest line is printed with. */
export const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Does this line survive this rule? */
export function satisfies(rule: Rule, line: ManifestLine): boolean {
  switch (rule.kind) {
    case 'sealParity': return (line.seal % 2 === 0) === rule.even;
    case 'berthIs': return line.berth === rule.berth;
    case 'berthIsNot': return line.berth !== rule.berth;
    case 'signedBefore': return line.signedAt < rule.minutes;
    case 'signedAfter': return line.signedAt > rule.minutes;
    case 'signerIs': return line.signer === rule.signer;
  }
}

/**
 * The rule as its holder reads it aloud — or, more often, taps to post.
 *
 * Written as something a port official would actually have been told, not as
 * a logic proposition, because it has to survive being read off a phone by
 * somebody who is not enjoying being put on the spot.
 */
export function ruleText(rule: Rule): string {
  switch (rule.kind) {
    case 'sealParity':
      return `A signed line always carries an ${rule.even ? 'even' : 'odd'} seal.`;
    case 'berthIs': return `Only berth ${rule.berth} was still loading.`;
    case 'berthIsNot': return `Berth ${rule.berth} was shut before the manifest closed.`;
    case 'signedBefore': return `Anything signed ${clockOf(rule.minutes)} or later is void.`;
    case 'signedAfter': return `Anything signed ${clockOf(rule.minutes)} or earlier is void.`;
    case 'signerIs': return `Only ${rule.signer} was still authorised to sign.`;
  }
}

/** Which lines survive every rule the room holds between them. */
export function survivors(puzzle: Pick<Puzzle, 'lines' | 'rules'>): ManifestLine[] {
  return puzzle.lines.filter((line) => puzzle.rules.every((rule) => satisfies(rule, line)));
}

/**
 * mulberry32 — small, fast, and seedable.
 *
 * Seeded on purpose: the property tests have to be able to run thousands of
 * generations and name the one that failed, and `Math.random` cannot be
 * asked to do that again.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a puzzle whose answer is `digit`, dealt across `playerCount` people.
 *
 * The digit comes first and the puzzle is built around it — exactly as
 * `survival_generate_key` already picks the code before anything else — so
 * the seal is unchanged: the answer lives where it always lived, and this
 * only decides how the room gets to it.
 *
 * Construction, in the order that makes it correct by design rather than by
 * checking afterwards:
 *
 *  1. The valid line carries the digit.
 *  2. Pick discriminating rules, all true of the valid line.
 *  3. Build each decoy to VIOLATE one of those rules. Every decoy is
 *     therefore excluded, and the valid line satisfies everything, so the
 *     answer is unique without a search.
 *  4. Pad out to one rule per player with more rules true of the valid line.
 *     Redundant fragments are not filler: at twenty players they are what
 *     lets somebody arrive late, or stay quiet, and still hold something
 *     worth trading.
 */
export function buildPuzzle(berth: number, digit: number, playerCount: number, seed: number): Puzzle {
  const random = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const shuffle = <T,>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };

  const valid: ManifestLine = {
    id: 1,
    berth,
    seal: digit,
    signedAt: between(18 * 60, 23 * 60 + 30),
    signer: pick(SIGNERS),
  };

  // Rules that are true of the valid line, each paired with the way a decoy
  // can be built to break it. Only rules that can actually discriminate are
  // offered — `sealAbove 0` against a seal of 0 would be false of the valid
  // line itself.
  const discriminators: { rule: Rule; breaker: (line: ManifestLine) => ManifestLine }[] = [
    {
      rule: { kind: 'berthIs', berth: valid.berth },
      breaker: (l) => ({ ...l, berth: (valid.berth % 4) + 1 }),
    },
    {
      rule: { kind: 'signerIs', signer: valid.signer },
      breaker: (l) => ({ ...l, signer: pick(SIGNERS.filter((s) => s !== valid.signer)) }),
    },
    {
      rule: { kind: 'signedAfter', minutes: valid.signedAt - 30 },
      breaker: (l) => ({ ...l, signedAt: valid.signedAt - 60 }),
    },
    {
      rule: { kind: 'signedBefore', minutes: valid.signedAt + 30 },
      breaker: (l) => ({ ...l, signedAt: valid.signedAt + 60 }),
    },
    {
      rule: { kind: 'sealParity', even: valid.seal % 2 === 0 },
      breaker: (l) => ({ ...l, seal: (valid.seal + 1) % 10 }),
    },
  ];

  const DECOYS = 4;
  // One discriminating rule per decoy, so each key rule is the only thing
  // ruling that decoy out and none of them is redundant. Capped by the room:
  // three players cannot hold four distinct rules, and a key rule nobody
  // holds is a puzzle nobody can finish.
  const keyCount = Math.max(1, Math.min(playerCount, DECOYS));
  const keys = shuffle([...discriminators]).slice(0, keyCount);

  const lines: ManifestLine[] = [valid];
  for (let d = 0; d < DECOYS; d += 1) {
    const { breaker } = keys[d % keyCount];
    let decoy = breaker({ ...valid, id: d + 2 });

    // A decoy sharing the answer's seal would let a wrong line give the
    // right digit, which quietly makes the deduction optional — so nudge it.
    // By TWO, not one: every decoy must break exactly the rule it was built
    // to break and no other, or that other rule stops being necessary and a
    // team holding a subset can already solve the board. Moving a seal by
    // one flips its parity and silently violates the parity rule as well.
    if (decoy.seal === digit) decoy = { ...decoy, seal: (digit + 2) % 10 };

    lines.push(decoy);
  }

  // Correct by construction above; asserted here because "exactly one rule"
  // is the property every downstream guarantee rests on, and a future
  // discriminator whose breaker has a side effect would otherwise weaken the
  // puzzle silently rather than loudly.
  for (const decoy of lines.slice(1)) {
    const broken = keys.filter((k) => !satisfies(k.rule, decoy)).length;
    if (broken !== 1) {
      throw new Error(`decoy ${decoy.id} breaks ${broken} key rules; it must break exactly one`);
    }
  }

  // Padding has to be true of EVERY line, not just the valid one.
  //
  // The obvious version of this — restate a key rule — is wrong, and wrong
  // in the way that matters: a padding copy of the signer rule keeps
  // excluding that rule's decoy after the key rule itself is dropped, so the
  // key rule stops being necessary and a team holding a subset can already
  // solve the board. Padding is a fragment somebody can hold and trade, not
  // a fragment that narrows anything.
  const earliest = Math.min(...lines.map((l) => l.signedAt));
  const latest = Math.max(...lines.map((l) => l.signedAt));
  const usedBerths = new Set(lines.map((l) => l.berth));
  const padding: Rule[] = [
    { kind: 'signedAfter', minutes: earliest - 1 } as Rule,
    { kind: 'signedBefore', minutes: latest + 1 } as Rule,
    ...[1, 2, 3, 4]
      .filter((b) => !usedBerths.has(b))
      .map((b): Rule => ({ kind: 'berthIsNot', berth: b })),
  ].filter((rule) => lines.every((line) => satisfies(rule, line)));

  const dealt: { rule: Rule; key: boolean }[] = keys.map((k) => ({ rule: k.rule, key: true }));
  while (dealt.length < playerCount) {
    dealt.push({ rule: padding[(dealt.length - keyCount) % padding.length], key: false });
  }

  shuffle(lines);
  lines.forEach((line, i) => { line.id = i + 1; });
  shuffle(dealt);

  return {
    berth,
    lines,
    rules: dealt.map((d) => d.rule),
    keyRuleIndices: dealt.flatMap((d, i) => (d.key ? [i] : [])),
    answerLineId: valid.id,
  };
}

/**
 * True when no single team already holds enough to name the answer.
 *
 * This is the load-bearing claim of the whole design. If one team's
 * fragments narrow the board to a single line, that team can assemble the
 * berth without speaking to anybody, and the puzzle stops being a reason to
 * negotiate across the room.
 *
 * `teams` are indices into `puzzle.rules` — the deal, not the roster.
 */
export function noTeamSolves(puzzle: Puzzle, teams: number[][]): boolean {
  return teams.every((team) => {
    const held = team.map((i) => puzzle.rules[i]);
    return puzzle.lines.filter((line) => held.every((rule) => satisfies(rule, line))).length > 1;
  });
}

/**
 * Deal the fragments so that claim holds.
 *
 * The key rules go round-robin across teams in a shuffled order, so with two
 * or more teams no team can hold all of them. Everybody else takes a
 * redundant rule. With a single team — a room of three, say — there is
 * nothing to spread across and the guarantee is simply unavailable; the
 * caller is expected to know that and not pretend otherwise.
 */
export function dealPuzzle(puzzle: Puzzle, teams: string[][], seed: number): Fragment[] {
  const random = rng(seed ^ 0x9e3779b9);
  const order = teams.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const keyRules = puzzle.keyRuleIndices.map((i) => puzzle.rules[i]);
  const spare = puzzle.rules.filter((_, i) => !puzzle.keyRuleIndices.includes(i));

  // Queue each team's members, and hand the key rules out one team at a time
  // so no team collects two before every team has one.
  const queues = order.map((t) => [...teams[t]]);
  const fragments: Fragment[] = [];
  let at = 0;
  for (const rule of keyRules) {
    for (let tries = 0; tries < queues.length; tries += 1) {
      const queue = queues[(at + tries) % queues.length];
      if (queue.length > 0) {
        fragments.push({ playerId: queue.shift() as string, rule, key: true });
        at = (at + tries + 1) % queues.length;
        break;
      }
    }
  }
  let s = 0;
  for (const queue of queues) {
    for (const playerId of queue) {
      fragments.push({ playerId, rule: spare[s % Math.max(1, spare.length)] ?? keyRules[0], key: false });
      s += 1;
    }
  }
  return fragments;
}
