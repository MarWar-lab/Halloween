import { useEffect, useRef } from 'react';
import type { CharacterLook } from '../game/types';
import type { Theme } from '../game/themes';
import { drawCharacter, drawNameplate, type CharState } from './character';
import {
  drawBackdrop,
  drawFire,
  drawFireGlow,
  drawRitualEffects,
  drawSceneDecor,
  type RitualEffects,
} from './fire';

export interface SceneCharacter {
  id: string;
  name: string;
  look: CharacterLook;
  state: CharState;
  away?: boolean;
}

export interface CampfireSceneProps {
  characters: SceneCharacter[];
  theme: Theme;
  /** Grows across the evening; the finale is a bonfire. */
  fireScale?: number;
  /** Draw the name under each character. Off on small player screens. */
  showNames?: boolean;
  /** Magnify everyone — used by the character customiser, where one figure
   *  fills the frame and the player needs to actually see what they picked. */
  zoom?: number;
  /** The customiser hides the fire so nothing competes with the character. */
  showFire?: boolean;
  /** Anonymous stage rituals: progress embers, vote candles, mood flares. */
  ritual?: RitualEffects | null;
  className?: string;
}

interface Seat {
  x: number;
  y: number;
  scale: number;
  light: number;
}

/**
 * Seats everyone on an elliptical arc behind the fire, all facing the viewer.
 *
 * Facing the viewer rather than each other is the readable choice: seen from
 * behind, half the ring would be the backs of heads, and the whole point is
 * that a person who never turns their camera on still has a visible face here.
 */
function seatPositions(count: number, w: number, h: number): Seat[] {
  const cx = w / 2;

  // One character is a portrait, not a ring: centre them and stand them at the
  // front, where the customiser can show them off.
  if (count === 1) return [{ x: cx, y: h * 0.86, scale: 1, light: 0.7 }];
  // The ring sits well above the fire: a shallow ellipse reads as a straight
  // line of people, and a fire drawn at the same height swallows whoever is
  // seated directly behind it — which is exactly where the speaker ends up.
  // The seats only ever use the *upper* half of this ellipse (see the angle
  // range below), so `cy` is where the nearest seat stands, not the middle of
  // the group. Placed too high and the tallest hat is cropped by the top of
  // the canvas — which is how a witch loses her point.
  const cy = h * 0.72;
  const rx = w * 0.34;
  const ry = h * 0.19;

  // One ring is comfortable up to nine; beyond that, split evenly into two.
  // An unbalanced split (nine in front, one behind) reads as a mistake rather
  // than as depth.
  const inner = count <= 9 ? count : Math.ceil(count / 2);
  const outer = count - inner;
  const seats: Seat[] = [];

  const place = (i: number, n: number, ringRx: number, ringRy: number, depth: number) => {
    // The back arc runs left, up and over to right — but with a gap held open
    // at top-centre, because that is exactly where the flame rises. Splitting
    // the cast into two half-arcs keeps that lane clear at any headcount, so
    // the person speaking is never the one hidden behind the fire.
    const from = Math.PI * 1.04;
    const to = Math.PI * 1.96;
    const gap = Math.PI * 0.05;
    const midL = Math.PI * 1.5 - gap;
    const midR = Math.PI * 1.5 + gap;

    const leftCount = Math.ceil(n / 2);
    const onLeft = i < leftCount;
    const segFrom = onLeft ? from : midR;
    const segTo = onLeft ? midL : to;
    const segN = onLeft ? leftCount : n - leftCount;
    const segI = onLeft ? i : i - leftCount;
    const angle = segN === 1 ? (segFrom + segTo) / 2 : segFrom + ((segTo - segFrom) * segI) / (segN - 1);

    const x = cx + Math.cos(angle) * ringRx;
    const y = cy + Math.sin(angle) * ringRy - depth;

    // Nearer the bottom of the frame reads as nearer the camera.
    const depthT = (y - (cy - ringRy - depth)) / (ringRy * 2 || 1);
    const scale = (0.74 + depthT * 0.42) * (depth > 0 ? 0.82 : 1);

    const dist = Math.hypot(x - cx, (y - cy) * 1.8);
    const light = Math.max(0, 1 - dist / (rx * 1.25));

    return { x, y, scale, light };
  };

  for (let i = 0; i < inner; i += 1) seats.push(place(i, inner, rx, ry, 0));
  for (let i = 0; i < outer; i += 1) {
    seats.push(place(i, outer, rx * 1.28, ry * 1.2, h * 0.1));
  }
  return seats;
}

export function CampfireScene({
  characters,
  theme,
  fireScale = 1,
  showNames = true,
  zoom = 1,
  showFire = true,
  ritual = null,
  className,
}: CampfireSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Kept in a ref so the animation loop is started once and never restarted by
  // a re-render — restarting it on every state change would reset the fire.
  const propsRef = useRef({ characters, theme, fireScale, showNames, zoom, showFire, ritual });
  propsRef.current = { characters, theme, fireScale, showNames, zoom, showFire, ritual };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const start = performance.now();
    let frame = 0;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      const {
        characters: cast, theme: th, fireScale: fs,
        showNames: names, zoom: mag, showFire: fire,
        ritual: sceneRitual,
      } = propsRef.current;

      ctx.clearRect(0, 0, width, height);
      drawBackdrop(ctx, width, height, th, t, reduceMotion);

      const fireX = width / 2;
      const fireY = height * 0.74;
      const sizeScale = Math.min(width / 700, height / 360);
      const s = Math.max(0.45, Math.min(1.4, sizeScale)) * mag;
      const fireBoost =
        sceneRitual &&
        ((sceneRitual.submitTotal > 0 && sceneRitual.sealed >= sceneRitual.submitTotal) ||
          (sceneRitual.voteTotal > 0 && sceneRitual.voted >= sceneRitual.voteTotal) ||
          sceneRitual.mood === 'scored' ||
          sceneRitual.mood === 'finale')
          ? 1.12
          : 1;

      if (fire) drawFireGlow(ctx, fireX, fireY, 300 * s * fs * fireBoost, th, t, reduceMotion);
      if (fire) drawSceneDecor(ctx, width, height, th, t, reduceMotion);

      const seats = seatPositions(cast.length, width, height);

      // Painter's algorithm: further up the frame is further away, so it is
      // drawn first and can be overlapped by whoever is nearer.
      const order = cast
        .map((c, i) => ({ c, seat: seats[i], i }))
        .sort((a, b) => a.seat.y - b.seat.y);

      for (const { c, seat, i } of order) {
        drawCharacter(ctx, {
          x: seat.x,
          y: seat.y,
          scale: seat.scale * s,
          look: c.look,
          state: c.state,
          t,
          theme: th,
          phase: i * 1.7,
          light: seat.light,
          away: c.away,
          reduceMotion,
        });
      }

      if (fire) {
        drawFire(ctx, {
          x: fireX,
          y: fireY,
          scale: s * fs * 1.3 * fireBoost,
          t,
          theme: th,
          reduceMotion,
        });
        drawRitualEffects(ctx, width, height, th, sceneRitual, t, reduceMotion);
      }

      // Nameplates last, so nobody's label is hidden behind a neighbour.
      if (names) {
        for (const { c, seat } of order) {
          drawNameplate(
            ctx,
            seat.x,
            seat.y,
            seat.scale * s,
            c.name,
            th,
            c.state === 'speaking' || c.state === 'winner',
          );
        }
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Decoration. Every fact the scene shows — who is up, the card, the
      // timer, the scores — also exists as real text elsewhere on the page,
      // so the game is fully playable without seeing this at all.
      aria-hidden="true"
    />
  );
}
