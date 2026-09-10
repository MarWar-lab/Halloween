/**
 * Procedural characters. No image assets — every character is drawn from a
 * handful of numbers, so a theme is a palette swap and the repo stays clean.
 *
 * The visual language is deliberately chunky: big flat shapes, thick outlines,
 * few internal details. That is not only a style choice. Half of this canvas is
 * screen-shared into a video call, and video compression destroys fine detail
 * and high-frequency motion while leaving large flat areas of colour intact.
 * The aesthetic and the delivery channel happen to want the same thing.
 */

import type { CharacterLook } from '../game/types';
import type { Theme } from '../game/themes';

export type CharState =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'laughing'
  | 'shocked'
  | 'voting'
  | 'passed'
  | 'winner';

export const BODY_TONES = [
  '#F2C9A0',
  '#DCA679',
  '#B87F4E',
  '#8A5A30',
  '#5E3A20',
  '#3D2717',
];

export const TOP_COLOURS = [
  '#C9463C',
  '#4F7FBF',
  '#5AA05F',
  '#B45FA0',
  '#E0A93C',
  '#5FBFC7',
  '#8B6FD6',
  '#D8734A',
];

const OUTLINE = '#150F1B';

/** Deterministic look from a name, so a player always gets the same character
 *  before they touch the customiser — and the same one again after a refresh. */
export function lookFromSeed(seed: string): CharacterLook {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (shift: number, mod: number) => Math.abs((h >> shift) % mod);
  return {
    body: n(0, BODY_TONES.length),
    topper: n(5, 6),
    top: n(11, TOP_COLOURS.length),
    accessory: n(17, 5),
  };
}

export interface DrawCharacterOptions {
  x: number;
  y: number;
  /** 1 = a character about 120px tall. */
  scale: number;
  look: CharacterLook;
  state: CharState;
  /** Seconds since scene start; drives all animation. */
  t: number;
  theme: Theme;
  /** Per-character phase offset so a crowd doesn't breathe in unison. */
  phase: number;
  /** 0-1. Characters further from the fire sit in less light. */
  light: number;
  /** Dim a player who has disconnected. */
  away?: boolean;
  reduceMotion?: boolean;
}

export function drawCharacter(ctx: CanvasRenderingContext2D, o: DrawCharacterOptions) {
  const { x, y, scale, look, state, theme, phase, light } = o;
  const t = o.reduceMotion ? 0 : o.t;

  const bodyColour = BODY_TONES[look.body % BODY_TONES.length];
  const topColour = TOP_COLOURS[look.top % TOP_COLOURS.length];

  // Breathing, and a bigger bob when they're the one talking.
  const breathe = Math.sin(t * 1.6 + phase) * 1.2;
  const bob =
    state === 'speaking' ? Math.sin(t * 6 + phase) * 2.5
    : state === 'laughing' ? Math.abs(Math.sin(t * 9 + phase)) * 5
    : 0;
  const lean = state === 'passed' ? 6 : state === 'shocked' ? -4 : 0;

  ctx.save();
  ctx.translate(x, y - bob - breathe);
  ctx.scale(scale, scale);
  ctx.globalAlpha = o.away ? 0.38 : 1;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;

  // ── seated body: a rounded trapezoid, wider at the base ──────────────────
  ctx.save();
  ctx.translate(0, lean * 0.4);
  ctx.rotate((lean * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.quadraticCurveTo(-22, -18, -13, -30);
  ctx.lineTo(13, -30);
  ctx.quadraticCurveTo(22, -18, 16, 0);
  ctx.closePath();
  ctx.fillStyle = topColour;
  ctx.fill();
  ctx.stroke();

  // ── arms ─────────────────────────────────────────────────────────────────
  const armUp = state === 'winner' || state === 'voting';
  ctx.beginPath();
  if (armUp) {
    ctx.moveTo(-13, -24);
    ctx.lineTo(-20, -42);
    ctx.moveTo(13, -24);
    ctx.lineTo(20, -42);
  } else if (state === 'shocked') {
    ctx.moveTo(-13, -24);
    ctx.lineTo(-19, -34);
    ctx.moveTo(13, -24);
    ctx.lineTo(19, -34);
  } else {
    ctx.moveTo(-14, -22);
    ctx.lineTo(-18, -8);
    ctx.moveTo(14, -22);
    ctx.lineTo(18, -8);
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = topColour;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // A voting paddle, so a silent vote is still visible in the scene.
  if (state === 'voting') {
    ctx.beginPath();
    ctx.roundRect(-30, -58, 20, 16, 3);
    ctx.fillStyle = theme.palette.text;
    ctx.fill();
    ctx.stroke();
  }

  // ── head ─────────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.ellipse(0, -44, 17, 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyColour;
  ctx.fill();
  ctx.stroke();

  drawFace(ctx, state, t, phase);
  drawTopper(ctx, look.topper, theme, topColour);

  ctx.restore();

  // ── firelight: a warm wash from below-left, stronger nearer the fire ──────
  if (light > 0.02) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.5, light) * (o.away ? 0.3 : 1);
    const glow = ctx.createRadialGradient(0, -20, 2, 0, -20, 46);
    glow.addColorStop(0, theme.palette.ember);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -20, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, state: CharState, t: number, phase: number) {
  // Blink: a short close on an irregular cycle so a crowd doesn't blink together.
  const cycle = (t * 0.9 + phase) % 4;
  const blinking = cycle > 3.85;
  const wide = state === 'shocked';
  const squeezed = state === 'laughing';

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;

  for (const ex of [-6.5, 6.5]) {
    ctx.beginPath();
    if (blinking || squeezed) {
      ctx.moveTo(ex - 4, -46);
      ctx.lineTo(ex + 4, -46);
      ctx.stroke();
      continue;
    }
    const rx = wide ? 5.5 : 4.5;
    const ry = wide ? 6 : 5;
    ctx.ellipse(ex, -46, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ex, -45.5, wide ? 1.8 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
  }

  // Mouth
  ctx.beginPath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;
  switch (state) {
    case 'speaking': {
      // Flaps open and shut; the amount is what reads at a distance.
      const open = 1.6 + Math.abs(Math.sin(t * 8 + phase)) * 3.4;
      ctx.ellipse(0, -36, 4.5, open, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3A1E22';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'laughing':
      ctx.arc(0, -38, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    case 'shocked':
      ctx.ellipse(0, -36, 3.4, 4.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3A1E22';
      ctx.fill();
      ctx.stroke();
      break;
    case 'passed':
      ctx.moveTo(-4, -36);
      ctx.lineTo(4, -37.5);
      ctx.stroke();
      break;
    case 'winner':
      ctx.arc(0, -38.5, 6.5, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      break;
    default:
      ctx.arc(0, -38, 4.5, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
  }
}

/**
 * Head-toppers. Index maps into Theme.toppers, so the same slot is a beanie by
 * the campfire and a witch's hat in the graveyard.
 */
function drawTopper(
  ctx: CanvasRenderingContext2D,
  index: number,
  theme: Theme,
  topColour: string,
) {
  const kind = theme.toppers[index % theme.toppers.length];
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;

  switch (kind) {
    case 'witch hat':
      ctx.beginPath();
      ctx.moveTo(-20, -56);
      ctx.lineTo(20, -56);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-13, -56);
      ctx.quadraticCurveTo(-2, -74, 6, -86);
      ctx.quadraticCurveTo(10, -70, 13, -56);
      ctx.closePath();
      ctx.fillStyle = '#2E2338';
      ctx.fill();
      ctx.stroke();
      break;

    case 'bandages':
      ctx.beginPath();
      ctx.rect(-17, -58, 34, 10);
      ctx.fillStyle = '#E8E0CE';
      ctx.fill();
      ctx.stroke();
      break;

    case 'sheet':
      ctx.beginPath();
      ctx.moveTo(-19, -40);
      ctx.quadraticCurveTo(-19, -66, 0, -66);
      ctx.quadraticCurveTo(19, -66, 19, -40);
      ctx.quadraticCurveTo(9, -34, 0, -40);
      ctx.quadraticCurveTo(-9, -34, -19, -40);
      ctx.closePath();
      ctx.fillStyle = '#EDE6D6';
      ctx.fill();
      ctx.stroke();
      break;

    case 'pumpkin':
      ctx.beginPath();
      ctx.ellipse(0, -46, 19, 17, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#E07B2C';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -64);
      ctx.lineTo(2, -70);
      ctx.strokeStyle = '#4E6B34';
      ctx.lineWidth = 4;
      ctx.stroke();
      break;

    case 'horns':
      ctx.fillStyle = '#D8CBB4';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 11, -56);
        ctx.quadraticCurveTo(s * 20, -64, s * 15, -74);
        ctx.quadraticCurveTo(s * 12, -64, s * 6, -57);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;

    case 'beanie':
      ctx.beginPath();
      ctx.arc(0, -50, 17, Math.PI, Math.PI * 2);
      ctx.rect(-17, -50, 34, 5);
      ctx.fillStyle = topColour;
      ctx.fill();
      ctx.stroke();
      break;

    case 'curls':
      ctx.fillStyle = '#3C2A22';
      for (const [cx, cy, r] of [
        [-13, -54, 8],
        [0, -60, 9],
        [13, -54, 8],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;

    case 'cap':
      ctx.beginPath();
      ctx.arc(0, -50, 16, Math.PI, Math.PI * 2);
      ctx.fillStyle = topColour;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(8, -50, 14, 4, 0, 0, Math.PI);
      ctx.fill();
      ctx.stroke();
      break;

    case 'bun':
      ctx.beginPath();
      ctx.arc(0, -62, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#3C2A22';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -50, 17, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
      ctx.stroke();
      break;

    default:
      break; // 'none' / 'bald'
  }
}

/** A label plate under a character. Drawn in DOM-quality type, not canvas text
 *  hinting, by keeping it large and high-contrast. */
export function drawNameplate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  name: string,
  theme: Theme,
  highlight = false,
) {
  const fontSize = Math.max(11, 13 * scale);
  ctx.font = `600 ${fontSize}px Archivo, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const padding = 7 * scale;
  const width = ctx.measureText(name).width + padding * 2;
  const height = fontSize + padding;
  // Clear of the feet, so a plate never sits over its own character — and far
  // enough down that a neighbour's plate is a separate object, not a collision.
  const top = y + 9 * scale;

  ctx.beginPath();
  ctx.roundRect(x - width / 2, top, width, height, 3);
  ctx.fillStyle = highlight ? theme.palette.ember : 'rgba(16,12,22,0.9)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = highlight ? theme.palette.ember : 'rgba(255,255,255,0.09)';
  ctx.stroke();

  ctx.fillStyle = highlight ? '#1A1206' : theme.palette.text;
  ctx.fillText(name, x, top + height / 2);
}
