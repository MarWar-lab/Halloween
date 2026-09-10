/**
 * The fire, the ground it sits on, and the world behind it.
 *
 * Motion here is deliberately low-amplitude and low-frequency. A realistic
 * particle fire looks superb locally and turns to mush the moment the host
 * shares their screen — video codecs spend their bitrate on whatever moves, so
 * a busy fire steals it from the card text nobody can then read.
 */

import type { Theme } from '../game/themes';

/** Cheap smooth noise. Deterministic, so the fire looks the same on every
 *  screen in the call — which matters when everyone is watching one share. */
function noise(t: number, seed: number): number {
  return (
    Math.sin(t * 1.7 + seed) * 0.5 +
    Math.sin(t * 3.1 + seed * 2.3) * 0.3 +
    Math.sin(t * 5.3 + seed * 4.1) * 0.2
  );
}

export interface FireOptions {
  x: number;
  y: number;
  /** 1 = a fire about 90px tall. Grows across the evening. */
  scale: number;
  t: number;
  theme: Theme;
  reduceMotion?: boolean;
}

export function drawFire(ctx: CanvasRenderingContext2D, o: FireOptions) {
  const { x, y, scale, theme } = o;
  const t = o.reduceMotion ? 0 : o.t;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // ── logs ─────────────────────────────────────────────────────────────────
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4A3526';
  ctx.lineWidth = 11;
  for (const [x1, y1, x2, y2] of [
    [-30, 4, 22, -6],
    [-22, -6, 30, 4],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#150F1B';
  ctx.lineWidth = 2.5;
  for (const [x1, y1, x2, y2] of [
    [-30, 4, 22, -6],
    [-22, -6, 30, 4],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // ── flames: three nested teardrops, each swaying on its own phase ────────
  const layers = [
    { h: 86, w: 26, colour: theme.palette.flame, seed: 0.0, alpha: 0.95 },
    { h: 62, w: 18, colour: theme.palette.ember, seed: 2.4, alpha: 1 },
    { h: 34, w: 10, colour: '#FFE9A8', seed: 5.1, alpha: 1 },
  ];

  for (const layer of layers) {
    const sway = noise(t, layer.seed) * 5;
    const stretch = 1 + noise(t * 1.3, layer.seed + 1) * 0.09;
    const h = layer.h * stretch;

    ctx.globalAlpha = layer.alpha;
    ctx.beginPath();
    ctx.moveTo(-layer.w, -2);
    ctx.quadraticCurveTo(-layer.w * 0.9, -h * 0.55, sway * 0.5, -h);
    ctx.quadraticCurveTo(layer.w * 0.9, -h * 0.55, layer.w, -2);
    ctx.quadraticCurveTo(0, 6, -layer.w, -2);
    ctx.closePath();
    ctx.fillStyle = layer.colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── embers ───────────────────────────────────────────────────────────────
  if (!o.reduceMotion) {
    for (let i = 0; i < 7; i += 1) {
      const life = (t * 0.35 + i / 7) % 1;
      const ex = noise(t * 0.6, i * 3.7) * 26;
      const ey = -20 - life * 120;
      ctx.globalAlpha = (1 - life) * 0.7;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = theme.palette.ember;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/** The warm pool of light the fire casts on the ground. Drawn before anyone. */
export function drawFireGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  theme: Theme,
  t: number,
  reduceMotion = false,
) {
  const flicker = reduceMotion ? 1 : 0.94 + noise(t, 9.3) * 0.06;
  const glow = ctx.createRadialGradient(x, y, 4, x, y, radius * flicker);
  glow.addColorStop(0, 'rgba(240,168,60,0.34)');
  glow.addColorStop(0.45, 'rgba(240,168,60,0.11)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * flicker, 0, Math.PI * 2);
  ctx.fill();

  void theme;
}

/** Backdrop: pines for the campfire, headstones for the graveyard. Static —
 *  nothing back here should compete with the cards or the characters. */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
) {
  // Night sky wash
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, theme.palette.night);
  sky.addColorStop(1, theme.palette.ground);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const horizon = h * 0.58;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';

  if (theme.scene === 'graveyard') {
    // Headstones, irregular so the row does not read as a fence.
    const stones = 11;
    for (let i = 0; i < stones; i += 1) {
      const sx = (w / stones) * (i + 0.5) + ((i * 37) % 23) - 11;
      const sh = 26 + ((i * 53) % 22);
      const sw = 20 + ((i * 29) % 12);
      ctx.beginPath();
      ctx.moveTo(sx - sw / 2, horizon);
      ctx.lineTo(sx - sw / 2, horizon - sh + sw / 2);
      ctx.arc(sx, horizon - sh + sw / 2, sw / 2, Math.PI, 0);
      ctx.lineTo(sx + sw / 2, horizon);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Pines
    const trees = 9;
    for (let i = 0; i < trees; i += 1) {
      const sx = (w / trees) * (i + 0.5) + ((i * 41) % 29) - 14;
      const th = 90 + ((i * 61) % 60);
      const tw = 34 + ((i * 23) % 16);
      ctx.beginPath();
      ctx.moveTo(sx, horizon - th);
      ctx.lineTo(sx - tw / 2, horizon);
      ctx.lineTo(sx + tw / 2, horizon);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Ground
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, horizon, w, h - horizon);
}
