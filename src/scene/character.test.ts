import { describe, expect, it } from 'vitest';
import { drawCharacter } from './character';
import { themes } from '../game/themes';

/**
 * A canvas context that records nothing and refuses nothing. The point of
 * these tests is that drawing *completes* — the scene is one uncaught throw
 * away from a blank rectangle, and a blank rectangle is the whole game.
 */
function stubCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {};
  const ctx: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => gradient;
      }
      if (prop === 'canvas') return { width: 800, height: 600 };
      if (prop in target) return target[prop as string];
      return () => {};
    },
    set(_t, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return ctx as CanvasRenderingContext2D;
}

const theme = themes[0];
const look = { body: 0, top: 0, topper: 0, accessory: 0 };

describe('drawCharacter', () => {
  /**
   * requestAnimationFrame reports the timestamp of the frame it is already
   * inside, which can predate the performance.now() captured when the scene
   * mounted a moment earlier in that same frame. The clock then runs a hair
   * below zero for one frame. A bare `%` keeps the sign, so Math.floor of a
   * small negative is -1, frames[-1] is undefined, and the whole canvas threw
   * on the first character on the first frame.
   */
  it('survives a clock that has not reached zero yet', () => {
    for (const t of [-0.001, -0.05, -1, -1000, 0]) {
      expect(() => drawCharacter(stubCtx(), {
        x: 100, y: 100, scale: 1, look, state: 'idle',
        t, theme, phase: 0, light: 1,
      }), `t=${t}`).not.toThrow();
    }
  });

  it('draws every pose at every phase offset without throwing', () => {
    const states = [
      'idle', 'listening', 'thinking', 'ready', 'nervous', 'speaking',
      'laughing', 'shocked', 'voting', 'applauding', 'passed', 'winner',
    ] as const;
    for (const state of states) {
      for (const phase of [0, 1.7, 3.4, 13.6]) {
        for (const t of [-0.02, 0, 0.37, 9999]) {
          expect(() => drawCharacter(stubCtx(), {
            x: 100, y: 100, scale: 1, look, state,
            t, theme, phase, light: 0.8,
          }), `${state} t=${t} phase=${phase}`).not.toThrow();
        }
      }
    }
  });

  it('draws every costume, skin and colour', () => {
    for (let topper = 0; topper < theme.toppers.length; topper += 1) {
      for (let body = 0; body < 6; body += 1) {
        for (let top = 0; top < 6; top += 1) {
          expect(() => drawCharacter(stubCtx(), {
            x: 100, y: 100, scale: 1,
            look: { body, top, topper, accessory: topper % 4 },
            state: 'idle', t: 1, theme, phase: 0, light: 1,
          }), `topper=${topper} body=${body} top=${top}`).not.toThrow();
        }
      }
    }
  });
});
