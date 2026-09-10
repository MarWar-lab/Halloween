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

export type RitualMood =
  | 'idle'
  | 'submitting'
  | 'revealing'
  | 'voting'
  | 'scored'
  | 'guesswho'
  | 'finale';

export type AtmosphereCue = 'hush' | 'drumroll' | 'cheer' | 'reveal';

export interface RitualEffects {
  /** Anonymous count of sealed answers. */
  sealed: number;
  /** People expected to answer. */
  submitTotal: number;
  /** Anonymous count of completed voters. */
  voted: number;
  /** People expected to vote. */
  voteTotal: number;
  /** How many revealed answers are on the shared screen. */
  answerCount: number;
  mood: RitualMood;
  cue?: AtmosphereCue | null;
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

export function drawSceneDecor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
  t: number,
  reduceMotion = false,
) {
  const graveyard = theme.scene === 'graveyard';
  const fireX = w / 2;
  const fireY = h * 0.74;
  const sizeScale = Math.max(0.65, Math.min(1.35, Math.min(w / 720, h / 440)));

  const pumpkins = graveyard
    ? [
        [-190, 34, 0.9, -0.08],
        [-128, 54, 0.58, 0.12],
        [136, 48, 0.72, -0.1],
        [208, 26, 0.82, 0.08],
        [18, 72, 0.5, 0.02],
      ]
    : [
        [-178, 40, 0.62, -0.08],
        [180, 38, 0.58, 0.08],
      ];

  for (let i = 0; i < pumpkins.length; i += 1) {
    const [dx, dy, s, tilt] = pumpkins[i];
    drawLittlePumpkin(ctx, fireX + dx * sizeScale, fireY + dy * sizeScale, s * sizeScale, tilt, t, i);
  }

  if (!graveyard) return;

  const ghosts = [
    [-265, -105, 0.52, 0],
    [270, -92, 0.46, 2.4],
    [-56, -150, 0.38, 4.1],
  ] as const;

  for (const [dx, dy, s, phase] of ghosts) {
    const bob = reduceMotion ? 0 : Math.sin(t * 0.9 + phase) * 7;
    drawAmbientGhost(ctx, fireX + dx * sizeScale, fireY + (dy + bob) * sizeScale, s * sizeScale, t, phase);
  }
}

export function drawRitualEffects(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
  ritual: RitualEffects | null | undefined,
  t: number,
  reduceMotion = false,
) {
  if (!ritual) return;
  const fireX = w / 2;
  const fireY = h * 0.74;
  const sizeScale = Math.max(0.65, Math.min(1.35, Math.min(w / 720, h / 440)));

  if (ritual.mood === 'guesswho') {
    drawGuessWhoMist(ctx, fireX, fireY - 46 * sizeScale, 250 * sizeScale, t, reduceMotion);
  }

  if (ritual.sealed > 0 || ritual.submitTotal > 0) {
    drawSealedEmbers(ctx, fireX, fireY, sizeScale, ritual, theme, t, reduceMotion);
  }

  if (ritual.voteTotal > 0 || ritual.answerCount > 0) {
    drawVoteCandles(ctx, fireX, fireY, sizeScale, ritual, theme, t, reduceMotion);
  }

  if (
    ritual.mood === 'scored' ||
    ritual.mood === 'finale' ||
    (ritual.submitTotal > 0 && ritual.sealed >= ritual.submitTotal) ||
    (ritual.voteTotal > 0 && ritual.voted >= ritual.voteTotal)
  ) {
    drawRitualFlare(ctx, fireX, fireY, 190 * sizeScale, theme, t, reduceMotion);
  }

  if (ritual.cue) {
    drawAtmosphereCue(ctx, fireX, fireY, sizeScale, ritual.cue, theme, t, reduceMotion);
  }
}

function drawLittlePumpkin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  tilt: number,
  t: number,
  seed: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(s, s);

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 17, 31, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#B85D24';
  ctx.fill();
  ctx.strokeStyle = '#130B10';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(35,17,5,0.38)';
  ctx.lineWidth = 2;
  for (const rx of [-12, 0, 12]) {
    ctx.beginPath();
    ctx.ellipse(rx, 0, 6, 21, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(6, -29, -3, -33);
  ctx.strokeStyle = '#4E6B34';
  ctx.lineWidth = 5;
  ctx.stroke();

  const glow = 0.55 + Math.sin(t * 4 + seed) * 0.16;
  ctx.fillStyle = `rgba(255,196,92,${glow})`;
  for (const ex of [-9, 9]) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, -6);
    ctx.lineTo(ex + 5, -4);
    ctx.lineTo(ex, 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-10, 9);
  ctx.lineTo(-5, 14);
  ctx.lineTo(0, 10);
  ctx.lineTo(5, 14);
  ctx.lineTo(10, 9);
  ctx.quadraticCurveTo(0, 18, -10, 9);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawAmbientGhost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  t: number,
  phase: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = 0.56;

  const glow = ctx.createRadialGradient(0, -18, 2, 0, -18, 70);
  glow.addColorStop(0, 'rgba(210,235,255,0.22)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -18, 70, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-24, 24);
  ctx.quadraticCurveTo(-30, -42, 0, -52);
  ctx.quadraticCurveTo(30, -42, 24, 24);
  ctx.quadraticCurveTo(16, 32, 10, 22);
  ctx.quadraticCurveTo(4, 33, -2, 22);
  ctx.quadraticCurveTo(-10, 34, -16, 22);
  ctx.quadraticCurveTo(-20, 30, -24, 24);
  ctx.closePath();
  ctx.fillStyle = '#DDE4EA';
  ctx.fill();
  ctx.strokeStyle = '#130B18';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#120D16';
  const blink = (t * 0.7 + phase) % 5 > 4.8;
  for (const ex of [-8, 8]) {
    ctx.beginPath();
    if (blink) ctx.ellipse(ex, -21, 5, 1.2, 0, 0, Math.PI * 2);
    else ctx.ellipse(ex, -21, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, -6, 3.2, 5.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSealedEmbers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  ritual: RitualEffects,
  theme: Theme,
  t: number,
  reduceMotion: boolean,
) {
  const total = Math.max(ritual.submitTotal, ritual.sealed);
  if (total <= 0) return;

  const slots = Math.min(18, total);
  const litSlots = Math.round((ritual.sealed / total) * slots);
  const rx = 160 * s;
  const ry = 42 * s;

  for (let i = 0; i < slots; i += 1) {
    const angle = Math.PI * 0.12 + (Math.PI * 0.76 * i) / Math.max(1, slots - 1);
    const px = x + Math.cos(angle) * rx;
    const py = y - 54 * s + Math.sin(angle) * ry;
    const lit = i < litSlots;
    const bob = reduceMotion || !lit ? 0 : Math.sin(t * 1.4 + i) * 4 * s;

    ctx.save();
    ctx.translate(px, py + bob);
    ctx.rotate((rnd(i * 19) - 0.5) * 0.45);
    if (lit) {
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 22 * s);
      glow.addColorStop(0, `${theme.palette.ember}AA`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 22 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#EFE6D6';
      ctx.strokeStyle = '#130B12';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.roundRect(-8 * s, -6 * s, 16 * s, 12 * s, 2 * s);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#756A77';
      ctx.beginPath();
      ctx.arc(0, 0, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawVoteCandles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  ritual: RitualEffects,
  theme: Theme,
  t: number,
  reduceMotion: boolean,
) {
  const total = Math.max(ritual.voteTotal, ritual.answerCount * 3);
  if (total <= 0) return;

  const slots = Math.min(24, Math.max(ritual.answerCount * 3, total));
  const litSlots =
    ritual.voteTotal > 0 ? Math.round((ritual.voted / ritual.voteTotal) * slots) : 0;
  const cols = Math.ceil(slots / 2);

  for (let i = 0; i < slots; i += 1) {
    const row = i % 2;
    const col = Math.floor(i / 2);
    const spread = cols <= 1 ? 0 : (col / (cols - 1) - 0.5) * 260 * s;
    const px = x + spread;
    const py = y + (38 + row * 20) * s;
    const lit = i < litSlots;

    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#E7DBC4';
    ctx.strokeStyle = '#130B12';
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    ctx.roundRect(-4 * s, -13 * s, 8 * s, 20 * s, 2 * s);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#24191B';
    ctx.fillRect(-0.7 * s, -15 * s, 1.4 * s, 3 * s);

    if (lit) {
      const flicker = reduceMotion ? 1 : 0.82 + Math.sin(t * 5 + i * 1.4) * 0.18;
      ctx.globalAlpha = flicker;
      ctx.beginPath();
      ctx.moveTo(0, -24 * s);
      ctx.quadraticCurveTo(-6 * s, -16 * s, 0, -11 * s);
      ctx.quadraticCurveTo(6 * s, -16 * s, 0, -24 * s);
      ctx.fillStyle = theme.palette.ember;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

function drawGuessWhoMist(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  reduceMotion: boolean,
) {
  const pulse = reduceMotion ? 1 : 0.88 + Math.sin(t * 1.2) * 0.08;
  const mist = ctx.createRadialGradient(x, y, 10, x, y, r * pulse);
  mist.addColorStop(0, 'rgba(95,191,199,0.18)');
  mist.addColorStop(0.55, 'rgba(95,191,199,0.08)');
  mist.addColorStop(1, 'transparent');
  ctx.fillStyle = mist;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
  ctx.fill();
}

function drawRitualFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  theme: Theme,
  t: number,
  reduceMotion: boolean,
) {
  const pulse = reduceMotion ? 1 : 0.76 + Math.abs(Math.sin(t * 2.6)) * 0.24;
  const flare = ctx.createRadialGradient(x, y - r * 0.25, 10, x, y - r * 0.25, r * pulse);
  flare.addColorStop(0, `${theme.palette.ember}44`);
  flare.addColorStop(0.45, `${theme.palette.flame}22`);
  flare.addColorStop(1, 'transparent');
  ctx.fillStyle = flare;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.25, r * pulse, 0, Math.PI * 2);
  ctx.fill();
}

function drawAtmosphereCue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  cue: AtmosphereCue,
  theme: Theme,
  t: number,
  reduceMotion: boolean,
) {
  const pulse = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(t * 5);
  if (cue === 'hush') {
    ctx.save();
    ctx.translate(x - 260 * s, y - 140 * s);
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    drawFog(ctx, 520 * s, 220 * s, 68 * s, t * 1.8, reduceMotion);
    ctx.restore();
    return;
  }

  const sparks = cue === 'drumroll' ? 16 : cue === 'cheer' ? 24 : 10;
  const colour = cue === 'reveal' ? '#DCE6F5' : theme.palette.ember;
  ctx.save();
  ctx.translate(x, y - 38 * s);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2 * s;
  ctx.globalAlpha = 0.55 + pulse * 0.32;
  for (let i = 0; i < sparks; i += 1) {
    const a = (Math.PI * 2 * i) / sparks + t * 0.18;
    const inner = (cue === 'drumroll' ? 78 : 48) * s;
    const outer = inner + (18 + rnd(i * 13) * 28) * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();
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
