import type { Card, Deck, Heat, Mechanic } from '../types';
import { halloween } from './halloween';

export const decks: Deck[] = [halloween];

export const deckById = (id: string): Deck =>
  decks.find((d) => d.id === id) ?? halloween;

export interface DrawFilter {
  heatCap: Heat;
  /** Cards already played this game. */
  usedIds: Set<string> | string[];
  mechanic?: Mechanic;
  /** When true, exclude cards that require a personal device. */
  deviceFree?: boolean;
}

/** Every card currently legal to draw. */
export function eligible(deck: Deck, f: DrawFilter): Card[] {
  const used = f.usedIds instanceof Set ? f.usedIds : new Set(f.usedIds);
  return deck.cards.filter(
    (c) =>
      c.heat <= f.heatCap &&
      !used.has(c.id) &&
      (!f.mechanic || c.mechanic === f.mechanic) &&
      (!f.deviceFree || !c.needsDevice),
  );
}

/**
 * Draw one card. `rand` is injected so tests are deterministic and so a game
 * can be replayed from a seed.
 *
 * Returns null rather than recycling a used card: the caller decides whether to
 * widen the filter or move the game on. Silently repeating a card mid-evening
 * is worse than the host seeing "this heat level is spent".
 */
export function draw(deck: Deck, f: DrawFilter, rand: () => number = Math.random): Card | null {
  const pool = eligible(deck, f);
  if (pool.length === 0) return null;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Deck design guarantee: at every heat level there are enough device-free cards
 * to run a whole game from the host's shared screen. Asserted by a unit test —
 * the multiplayer half must always be an enhancement, never a requirement.
 */
export function deviceFreeCountByHeat(deck: Deck): Record<Heat, number> {
  const counts: Record<Heat, number> = { 1: 0, 2: 0, 3: 0 };
  for (const c of deck.cards) if (!c.needsDevice) counts[c.heat] += 1;
  return counts;
}
