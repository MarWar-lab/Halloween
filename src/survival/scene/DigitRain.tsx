/**
 * Falling columns of digits — the picture on the screen inside `Terminal`
 * (see `./Terminal.tsx`), never behind the text a player has to read. An
 * earlier version sat as a translucent wash under the manifest line itself
 * and just made it harder to read; this is the redraw, as its own object
 * instead of a background.
 *
 * Purely original: random 0-9 glyphs streaming down a canvas, nothing more
 * specific than that. Colour is the only thing that carries meaning
 * (`color` mirrors `Question.manifest.color`, green or red per berth), and
 * colour is never the ONLY way that meaning reaches the player — the
 * bezel/border around it states it too.
 *
 * A real canvas with its own rAF loop, unlike the rest of this game's
 * screens — but scoped to exactly this one decorative element, cleaned up
 * on unmount, and inert under `prefers-reduced-motion`. `draw` and the loop
 * that reschedules it are kept as two separate functions on purpose (see
 * archive/campfire/scene/Campfire.tsx for the two traps that pattern avoids:
 * a loop that reschedules itself from inside `draw` can spawn a second timer
 * per mount, and the animation's own clock must never go negative or an
 * `Array` index built from it will read `undefined`).
 */

import { useEffect, useRef } from 'react';

export interface DigitRainProps {
  color: 'green' | 'red';
  /** Drama scales with this — 0 is nearly still, 1 is a downpour. */
  intensity?: number;
}

const GLYPH_COLOR = { green: '#3ddc84', red: '#ff4d4d' } as const;
const GLYPH_COLOR_DIM = { green: '#1f6f47', red: '#8a2a2a' } as const;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function DigitRain({ color, intensity = 0.6 }: DigitRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fontSize = 14;
    let width = 0;
    let height = 0;
    let columnCount = 0;
    // How far down each column has fallen, in glyph-rows — fractional, so
    // speed can vary smoothly between columns rather than only per-frame-tick.
    let drops: number[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columnCount = Math.max(1, Math.floor(width / fontSize));
      drops = Array.from({ length: columnCount }, () => Math.random() * -20);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let stopped = false;

    const draw = () => {
      // A translucent fill instead of a clear: each glyph leaves a fading
      // trail rather than popping in and out, which is most of what reads
      // as "rain" rather than "random digits."
      ctx.fillStyle = 'rgba(5, 7, 10, 0.22)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px ${getComputedStyle(canvas).getPropertyValue('--mono') || 'monospace'}`;

      for (let i = 0; i < columnCount; i += 1) {
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        // The lead glyph of each column is brighter than the ones trailing
        // above it — the same "front of the wave is brightest" cue real
        // falling rain reads as, done with two flat colours instead of a
        // gradient per glyph.
        ctx.fillStyle = Math.random() < 0.08 ? GLYPH_COLOR[color] : GLYPH_COLOR_DIM[color];
        ctx.fillText(String(Math.floor(Math.random() * 10)), x, y);

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0;
        } else {
          drops[i] += 0.15 + intensity * 0.35;
        }
      }
    };

    const loop = () => {
      if (stopped) return;
      draw();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [color, intensity]);

  return <canvas ref={canvasRef} className="digit-rain" aria-hidden="true" />;
}
