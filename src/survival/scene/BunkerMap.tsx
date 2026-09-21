/**
 * The room, as a wall of lights.
 *
 * Sits behind every screen of the game, not just one moment of it — a
 * persistent, ambient presence rather than a per-scene decoration. Each node
 * is a player and nothing else: no name, no score, no odds. What moves is a
 * single shared `tension` value (see `../tension.ts`), computed purely from
 * facts every viewer already has, so this component never receives — and
 * could never leak — anything sealed.
 *
 * Deliberately not a canvas: this is a dozen-ish slow-moving circles, not a
 * particle system, and SVG keeps it crisp, inspectable and free of a
 * render-loop to manage. `character.test.ts` on the Campfire side exists
 * because *that* scene throws if it draws wrong; this one has nothing
 * equivalent to throw, by design.
 */

import { useMemo } from 'react';

export interface BunkerMapProps {
  playerCount: number;
  /** 0 (calm) to 1 (everyone stuck on something at once). */
  tension: number;
}

/** A small deterministic scatter so nodes don't sit in a sterile grid. */
function jitter(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
}

function layout(count: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.6)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = 100 / (cols + 1);
  const cellH = 100 / (rows + 1);
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: cellW * (col + 1) + jitter(i * 2 + 1, cellW * 0.25),
      y: cellH * (row + 1) + jitter(i * 2 + 2, cellH * 0.25),
    };
  });
}

export function BunkerMap({ playerCount, tension }: BunkerMapProps) {
  const nodes = useMemo(() => layout(Math.max(0, playerCount)), [playerCount]);
  const clamped = Math.max(0, Math.min(1, tension));

  // Calm reads as steady and bright; tense reads as dim, desaturated and
  // faster-flickering. Both ends stay well clear of fully off — a node
  // going dark would read as "that person is gone," which is not a fact
  // this component is allowed to state.
  const baseOpacity = 0.85 - clamped * 0.35;
  const flickerSpeed = 3 - clamped * 2;

  return (
    <div className="bunker-map" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {nodes.map((node, i) => (
          <circle
            key={i}
            cx={node.x}
            cy={node.y}
            r={1.1}
            className="bunker-node"
            style={{
              // The keyframe animation reads this custom property rather than
              // an inline `opacity`, so the flicker oscillates AROUND the
              // tension-driven baseline instead of a fixed inline value
              // overriding the animation on every render.
              ['--bunker-base-opacity' as string]: baseOpacity,
              animationDuration: `${flickerSpeed + jitter(i * 7, 0.6)}s`,
              animationDelay: `${jitter(i * 3, flickerSpeed)}s`,
              filter: `saturate(${1 - clamped * 0.6})`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
