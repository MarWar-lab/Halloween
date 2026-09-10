/**
 * The fire, and the world behind it.
 *
 * Everything here is drawn, never loaded — so a theme is a palette swap and the
 * repo carries no assets. Motion stays low-amplitude and low-frequency on
 * purpose: video codecs spend their bitrate on whatever moves, and a busy fire
 * steals it from the card text nobody can then read on the shared screen.
 *
 * The atmosphere does the Halloween work — moon, dead trees, drifting fog,
 * bats, eyes in the dark — so the characters don't have to shout it.
 */

import type { Theme } from '../game/themes';

/** Cheap deterministic smooth noise — the same on every screen in the call. */
function noise(t: number, seed: number): number {
  return (
    Math.sin(t * 1.7 + seed) * 0.5 +
    Math.sin(t * 3.1 + seed * 2.3) * 0.3 +
    Math.sin(t * 5.3 + seed * 4.1) * 0.2
  );
}

/** Deterministic pseudo-random from an integer, for scenery placement. */
function rnd(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export interface FireOptions {
  x: number;
  y: number;
  scale: number;
  t: number;
  theme: Theme;
  reduceMotion?: boolean;
}

export function drawFire(ctx: CanvasRenderingContext2D, o: FireOptions) {
  const { x, y, scale, theme } = o;
  const t = o.reduceMotion ? 0 : o.t;
  const graveyard = theme.scene === 'graveyard';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (graveyard) drawCauldron(ctx);
  else drawLogs(ctx);

  // Flames: nested teardrops, each swaying on its own phase. A cauldron burns
  // green, a campfire burns warm.
  const layers = graveyard
    ? [
        { h: 74, w: 22, colour: '#2E7D52', seed: 0.0, alpha: 0.9 },
        { h: 54, w: 15, colour: '#57C07A', seed: 2.4, alpha: 0.95 },
        { h: 30, w: 9, colour: '#C9F5C0', seed: 5.1, alpha: 1 },
      ]
    : [
        { h: 84, w: 25, colour: theme.palette.flame, seed: 0.0, alpha: 0.95 },
        { h: 60, w: 17, colour: theme.palette.ember, seed: 2.4, alpha: 1 },
        { h: 33, w: 10, colour: '#FFE9A8', seed: 5.1, alpha: 1 },
      ];

  const baseY = graveyard ? -26 : -2;

  for (const layer of layers) {
    const sway = noise(t, layer.seed) * 5;
    const h = layer.h * (1 + noise(t * 1.3, layer.seed + 1) * 0.09);

    ctx.globalAlpha = layer.alpha;
    ctx.beginPath();
    ctx.moveTo(-layer.w, baseY);
    ctx.quadraticCurveTo(-layer.w * 0.9, baseY - h * 0.55, sway * 0.5, baseY - h);
    ctx.quadraticCurveTo(layer.w * 0.9, baseY - h * 0.55, layer.w, baseY);
    ctx.quadraticCurveTo(0, baseY + 8, -layer.w, baseY);
    ctx.closePath();
    ctx.fillStyle = layer.colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Embers, or rising spirit motes over the cauldron.
  if (!o.reduceMotion) {
    for (let i = 0; i < 8; i += 1) {
      const life = (t * 0.32 + i / 8) % 1;
      const ex = noise(t * 0.6, i * 3.7) * 26;
      const ey = baseY - 24 - life * 130;
      ctx.globalAlpha = (1 - life) * 0.7;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.9, 0, Math.PI * 2);
      ctx.fillStyle = graveyard ? '#8FE8B0' : theme.palette.ember;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawLogs(ctx: CanvasRenderingContext2D) {
  const logs: [number, number, number, number][] = [
    [-32, 4, 24, -6],
    [-24, -6, 32, 4],
  ];
  for (const [x1, y1, x2, y2] of logs) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#4A3526';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = '#150F1B';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function drawCauldron(ctx: CanvasRenderingContext2D) {
  // Legs
  ctx.strokeStyle = '#241A28';
  ctx.lineWidth = 5;
  for (const lx of [-16, 0, 16]) {
    ctx.beginPath();
    ctx.moveTo(lx * 0.7, -8);
    ctx.lineTo(lx, 8);
    ctx.stroke();
  }

  // Belly
  ctx.beginPath();
  ctx.ellipse(0, -14, 30, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#231A2A';
  ctx.fill();
  ctx.strokeStyle = '#0E0912';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Rim, and the glow off the brew inside it
  ctx.beginPath();
  ctx.ellipse(0, -28, 26, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#141019';
  ctx.fill();
  ctx.strokeStyle = '#3A2C44';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, -28, 21, 5.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2E7D52';
  ctx.fill();
}

/** The pool of light on the ground. Drawn before anyone stands in it. */
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
  const r = radius * flicker;
  const warm = theme.scene === 'graveyard' ? '87,192,122' : '240,168,60';

  const glow = ctx.createRadialGradient(x, y, 4, x, y, r);
  glow.addColorStop(0, `rgba(${warm},0.30)`);
  glow.addColorStop(0.45, `rgba(${warm},0.10)`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── the world behind the fire ─────────────────────────────────────────────

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
  t = 0,
  reduceMotion = false,
) {
  const graveyard = theme.scene === 'graveyard';
  const horizon = h * 0.56;

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, graveyard ? '#0D0A14' : '#100D17');
  sky.addColorStop(0.55, theme.palette.night);
  sky.addColorStop(1, theme.palette.ground);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawStars(ctx, w, horizon, t, reduceMotion);
  drawMoon(ctx, w * 0.82, h * 0.16, Math.max(26, h * 0.075), graveyard);

  if (graveyard) {
    drawDeadTrees(ctx, w, horizon);
    drawHeadstones(ctx, w, horizon);
  } else {
    drawPines(ctx, w, horizon);
  }

  if (!reduceMotion) drawBats(ctx, w, h, t, graveyard);

  // Ground
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, 'rgba(0,0,0,0.34)');
  ground.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);

  drawEyesInTheDark(ctx, w, horizon, t, reduceMotion);
  drawFog(ctx, w, h, horizon, t, reduceMotion);
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  w: number,
  horizon: number,
  t: number,
  reduceMotion: boolean,
) {
  for (let i = 0; i < 60; i += 1) {
    const sx = rnd(i * 2.1) * w;
    const sy = rnd(i * 3.7) * horizon * 0.8;
    const twinkle = reduceMotion ? 0.5 : 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.4 + i));
    ctx.globalAlpha = twinkle * 0.8;
    ctx.beginPath();
    ctx.arc(sx, sy, rnd(i * 5.3) * 1.1 + 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF4DC';
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  graveyard: boolean,
) {
  const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3.4);
  halo.addColorStop(0, graveyard ? 'rgba(206,226,255,0.16)' : 'rgba(255,240,210,0.14)');
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = graveyard ? '#DCE6F5' : '#F5E9CC';
  ctx.fill();

  // Craters
  ctx.fillStyle = 'rgba(90,96,120,0.22)';
  const craters: [number, number, number][] = [
    [-0.3, -0.22, 0.22],
    [0.26, 0.1, 0.16],
    [-0.1, 0.36, 0.13],
    [0.34, -0.36, 0.1],
  ];
  for (const [cx, cy, cr] of craters) {
    ctx.beginPath();
    ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPines(ctx: CanvasRenderingContext2D, w: number, horizon: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  const trees = 11;
  for (let i = 0; i < trees; i += 1) {
    const sx = (w / trees) * (i + 0.5) + (rnd(i) - 0.5) * 40;
    const th = 90 + rnd(i * 7) * 70;
    const tw = 32 + rnd(i * 11) * 20;
    for (let tier = 0; tier < 3; tier += 1) {
      const ty = horizon - (th * tier) / 3.4;
      const tScale = 1 - tier * 0.22;
      ctx.beginPath();
      ctx.moveTo(sx, ty - th * 0.5);
      ctx.lineTo(sx - (tw / 2) * tScale, ty);
      ctx.lineTo(sx + (tw / 2) * tScale, ty);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Bare branching trees. Recursive, so no two are the same shape. */
function drawDeadTrees(ctx: CanvasRenderingContext2D, w: number, horizon: number) {
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineCap = 'round';

  const branch = (
    x: number,
    y: number,
    angle: number,
    len: number,
    width: number,
    seed: number,
    depth: number,
  ) => {
    if (depth > 4 || len < 6) return;
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const spread = 0.42 + rnd(seed) * 0.4;
    branch(ex, ey, angle - spread, len * 0.72, width * 0.66, seed + 1, depth + 1);
    branch(ex, ey, angle + spread * 0.9, len * 0.68, width * 0.62, seed + 2, depth + 1);
    if (rnd(seed * 3) > 0.6) {
      branch(ex, ey, angle + (rnd(seed) - 0.5) * 0.3, len * 0.6, width * 0.5, seed + 3, depth + 1);
    }
  };

  for (const [px, s] of [
    [0.08, 3],
    [0.3, 17],
    [0.62, 29],
    [0.93, 41],
  ] as [number, number][]) {
    branch(w * px, horizon, -Math.PI / 2 + (rnd(s) - 0.5) * 0.25, 44 + rnd(s) * 26, 7, s, 0);
  }
}

function drawHeadstones(ctx: CanvasRenderingContext2D, w: number, horizon: number) {
  const stones = 13;
  for (let i = 0; i < stones; i += 1) {
    const sx = (w / stones) * (i + 0.5) + (rnd(i * 13) - 0.5) * 34;
    const sh = 24 + rnd(i * 5) * 26;
    const sw = 18 + rnd(i * 9) * 14;
    const tilt = (rnd(i * 3) - 0.5) * 0.18;

    ctx.save();
    ctx.translate(sx, horizon);
    ctx.rotate(tilt);
    ctx.fillStyle = 'rgba(0,0,0,0.46)';

    ctx.beginPath();
    if (rnd(i * 21) > 0.72) {
      // A cross, for variety in the silhouette.
      ctx.rect(-sw * 0.16, -sh, sw * 0.32, sh);
      ctx.rect(-sw * 0.5, -sh * 0.78, sw, sw * 0.28);
    } else {
      ctx.moveTo(-sw / 2, 0);
      ctx.lineTo(-sw / 2, -sh + sw / 2);
      ctx.arc(0, -sh + sw / 2, sw / 2, Math.PI, 0);
      ctx.lineTo(sw / 2, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }
}

function drawBats(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  graveyard: boolean,
) {
  const count = graveyard ? 5 : 2;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';

  for (let i = 0; i < count; i += 1) {
    // Slow drift across the sky, wrapping around.
    const speed = 14 + rnd(i * 7) * 10;
    const bx = ((t * speed + rnd(i) * w * 2) % (w + 140)) - 70;
    const by = h * (0.1 + rnd(i * 3) * 0.26) + Math.sin(t * 1.1 + i * 2) * 14;
    const flap = Math.sin(t * 7 + i * 1.7);
    const s = 6 + rnd(i * 11) * 4;

    ctx.save();
    ctx.translate(bx, by);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-s * 0.8, -s * 0.5 * flap - s * 0.2, -s * 2, flap * s * 0.3);
    ctx.quadraticCurveTo(-s * 0.9, flap * s * 0.2, 0, s * 0.35);
    ctx.quadraticCurveTo(s * 0.9, flap * s * 0.2, s * 2, flap * s * 0.3);
    ctx.quadraticCurveTo(s * 0.8, -s * 0.5 * flap - s * 0.2, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Pairs of eyes blinking on in the treeline, then gone. */
function drawEyesInTheDark(
  ctx: CanvasRenderingContext2D,
  w: number,
  horizon: number,
  t: number,
  reduceMotion: boolean,
) {
  if (reduceMotion) return;

  for (let i = 0; i < 4; i += 1) {
    // Each pair appears for a couple of seconds on its own long cycle.
    const cycle = (t * 0.1 + rnd(i * 31)) % 1;
    if (cycle > 0.16) continue;

    const fade = Math.sin((cycle / 0.16) * Math.PI);
    const ex = rnd(i * 17) * w;
    const ey = horizon - 12 - rnd(i * 23) * 26;

    ctx.globalAlpha = fade * 0.85;
    ctx.fillStyle = i % 2 === 0 ? '#F0A83C' : '#8FE8B0';
    for (const dx of [-4.5, 4.5]) {
      ctx.beginPath();
      ctx.ellipse(ex + dx, ey, 2.6, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Low fog banks drifting across the ground. */
function drawFog(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  t: number,
  reduceMotion: boolean,
) {
  ctx.save();
  for (let layer = 0; layer < 3; layer += 1) {
    const speed = reduceMotion ? 0 : (layer + 1) * 5;
    const offset = ((t * speed) % (w + 400)) - 200;
    const y = horizon + 6 + layer * (h - horizon) * 0.22;
    const height = 26 + layer * 12;

    const grad = ctx.createLinearGradient(0, y - height, 0, y + height);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.5, `rgba(180,186,210,${0.05 + layer * 0.016})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(-200, y + height);
    for (let bx = -200; bx <= w + 200; bx += 60) {
      const wob = Math.sin((bx + offset) * 0.012 + layer) * 9;
      ctx.lineTo(bx, y + wob);
    }
    ctx.lineTo(w + 200, y + height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
