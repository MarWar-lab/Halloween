/**
 * Procedural characters — an articulated rig, drawn to canvas.
 *
 * The rig follows the same idea as the IOTA FightClub sprite: a table of
 * keyframes per state, where each frame is a set of joint rotations, and limbs
 * are drawn as groups rotating about fixed pivots. Hair and cloaks lag one
 * frame behind the body, which is what sells them as cloth rather than
 * cardboard.
 *
 * Canvas rather than SVG because twenty of these animate at once around the
 * fire; twenty articulated SVG rigs re-rendering through React would not hold
 * frame rate. The trade is that everything here is hand-drawn geometry.
 *
 * Still deliberately chunky and high-contrast: half of this is screen-shared
 * into a video call, and compression destroys fine detail while leaving big
 * flat shapes intact.
 */

import type { CharacterLook } from '../game/types';
import type { Theme } from '../game/themes';

export type CharState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'ready'
  | 'nervous'
  | 'speaking'
  | 'laughing'
  | 'shocked'
  | 'voting'
  | 'applauding'
  | 'passed'
  | 'winner';

/**
 * Keyframes: [bodyY, bodyRot, rArm, lArm, rLeg, lLeg, headX, headY, hairRot, cloakRot]
 * Rotations in degrees. Arms pivot at the shoulders, legs at the hips.
 */
const FRAMES: Record<CharState, number[][]> = {
  idle: [
    [0, 0, -8, 8, 0, 0, 0, 0, 0, 0],
    [-1, 0, -10, 10, 0, 0, 0, -1, 1.5, 2],
    [-2, 0, -9, 9, 0, 0, 0, -2, 0, 3],
    [-1, 0, -7, 7, 0, 0, 0, -1, -1.5, 1],
  ],
  listening: [
    [0, -3, -6, 11, 0, 0, -2, 0, 0, -1],
    [-1, -3, -7, 12, 0, 0, -3, -1, 1, 0],
    [-2, -4, -6, 11, 0, 0, -3, -1, 0, 1],
    [-1, -3, -5, 10, 0, 0, -2, 0, -1, 0],
  ],
  thinking: [
    [0, -2, 16, -8, 0, 0, -2, 0, 1, 1],
    [-1, -3, 18, -9, 0, 0, -3, -1, 2, 2],
    [-2, -4, 14, -7, 0, 0, -3, -2, 0, 1],
    [-1, -2, 17, -8, 0, 0, -2, -1, -1, 0],
  ],
  ready: [
    [-1, 1, -96, 8, 0, 0, 1, -2, 3, 4],
    [-3, 1, -102, 10, 0, 0, 1, -3, 4, 5],
    [-1, 0, -92, 8, 0, 0, 0, -2, 2, 3],
  ],
  nervous: [
    [0, -5, 4, 18, 1, -1, -3, 0, 2, 3],
    [-2, 5, -2, 12, -1, 1, 3, -1, -2, -3],
    [1, -4, 5, 16, 1, -1, -2, 1, 3, 4],
    [-1, 4, -3, 14, -1, 1, 2, -1, -3, -2],
  ],
  speaking: [
    [0, 0, -22, 14, 0, 0, 0, -1, 2, 2],
    [-2, 2, -38, 22, 0, 0, 1, -2, 4, 6],
    [0, -1, -18, 10, 0, 0, 0, 0, -2, 0],
    [-2, 1, -32, 26, 0, 0, 0, -2, 3, 5],
  ],
  laughing: [
    [-3, -4, -26, 26, 0, 0, 0, -3, -4, -3],
    [-7, -6, -34, 34, 0, 0, 0, -7, -7, -6],
    [-3, -4, -26, 26, 0, 0, 0, -3, -4, -3],
    [-1, -2, -20, 20, 0, 0, 0, -1, -2, -1],
  ],
  shocked: [
    [2, -8, -52, 52, 4, -4, -3, 1, -6, -9],
    [1, -10, -62, 62, 5, -5, -4, 0, -8, -11],
  ],
  voting: [
    [0, 0, -112, 10, 0, 0, 0, -1, 3, 2],
    [-1, 0, -118, 12, 0, 0, 0, -2, 4, 3],
  ],
  applauding: [
    [-2, -1, -62, 62, 0, 0, 0, -2, 4, 5],
    [-4, 1, -84, 84, 0, 0, 1, -4, 6, 7],
    [-2, -1, -56, 56, 0, 0, 0, -2, 4, 5],
    [-1, 0, -76, 76, 0, 0, -1, -1, 5, 6],
  ],
  passed: [
    [4, 7, 12, -8, 0, 0, 3, 3, 6, 7],
    [5, 8, 14, -6, 0, 0, 4, 4, 7, 8],
  ],
  winner: [
    [-4, 0, -136, 136, 3, -3, 0, -4, 7, 9],
    [-11, 0, -142, 142, 7, -7, 0, -9, 10, 13],
    [-4, 0, -134, 134, 3, -3, 0, -4, 7, 9],
    [0, 0, -130, 130, 0, 0, 0, -1, 5, 7],
  ],
};

/** Milliseconds per frame, per state. */
const FRAME_MS: Record<CharState, number> = {
  idle: 420,
  listening: 460,
  thinking: 520,
  ready: 360,
  nervous: 110,
  speaking: 150,
  laughing: 130,
  shocked: 320,
  voting: 400,
  applauding: 120,
  passed: 700,
  winner: 160,
};

export const BODY_TONES = ['#F2C9A0', '#DCA679', '#B87F4E', '#8A5A30', '#5E3A20', '#3D2717'];

export const TOP_COLOURS = [
  '#8B2635', // dried blood
  '#3D5A80', // midnight blue
  '#4A7C4E', // swamp green
  '#6B3FA0', // witch purple
  '#C4642A', // pumpkin
  '#2F6F73', // ghoul teal
  '#7A2E5C', // plum
  '#B5651D', // rust
];

const OUTLINE = '#0E0912';
const EYE_WHITE = '#F6F1E4';

/** Deterministic look from a name — the same character before and after a
 *  refresh, and before anyone touches the customiser. */
export function lookFromSeed(seed: string): CharacterLook {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (shift: number, mod: number) => Math.abs((h >> shift) % mod);
  return {
    body: n(0, BODY_TONES.length),
    topper: n(5, 997),
    top: n(11, TOP_COLOURS.length),
    accessory: n(17, 997),
  };
}

export interface DrawCharacterOptions {
  x: number;
  /** Ground line — the character's feet. */
  y: number;
  /** 1 ≈ a 150px-tall character. */
  scale: number;
  look: CharacterLook;
  state: CharState;
  /** Seconds since scene start. */
  t: number;
  theme: Theme;
  /** Per-character offset so a crowd doesn't move in lockstep. */
  phase: number;
  /** 0-1, how much firelight reaches them. */
  light: number;
  away?: boolean;
  reduceMotion?: boolean;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function drawCharacter(ctx: CanvasRenderingContext2D, o: DrawCharacterOptions) {
  const { x, y, scale, look, state, theme, phase, light } = o;

  const frames = FRAMES[state] ?? FRAMES.idle;
  const ms = FRAME_MS[state] ?? 400;

  // Interpolate between keyframes so the rig reads as animation rather than a
  // slideshow, and hold frame 0 when motion is reduced.
  let f = frames[0];
  let prev = frames[0];
  if (!o.reduceMotion && frames.length > 1) {
    // Wrap into range by hand. The clock can run backwards past zero for a
    // frame — requestAnimationFrame hands back the timestamp of the frame it
    // is already inside, which can predate the performance.now() taken when
    // the scene mounted — and a bare `%` keeps the sign, so Math.floor of a
    // small negative is -1 and frames[-1] is undefined. That crashed the whole
    // canvas on the first character on the first frame.
    const n = frames.length;
    const raw = (o.t * 1000 + phase * 220) / ms;
    const pos = ((raw % n) + n) % n;
    const i = Math.floor(pos);
    const k = pos - i;
    const a = frames[i];
    const b = frames[(i + 1) % n];
    f = a.map((v, m) => lerp(v, b[m], k));
    // Hair and cloak trail the body by roughly one frame.
    prev = frames[(i - 1 + n) % n];
  }

  const [by, br, rArm, lArm, rLeg, lLeg, hx, hy] = f;
  const hairRot = prev[8];
  const cloakRot = prev[9];

  const skin = BODY_TONES[look.body % BODY_TONES.length];
  const cloth = TOP_COLOURS[look.top % TOP_COLOURS.length];
  const costume = theme.toppers[look.topper % theme.toppers.length];

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = o.away ? 0.32 : 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Contact shadow — without it everyone floats.
  ctx.beginPath();
  ctx.ellipse(0, 2, 22, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();

  ctx.translate(0, by);
  ctx.rotate(rad(br));

  const ghost = costume === 'ghost';

  if (ghost) {
    drawGhostBody(ctx, cloth, skin, cloakRot);
  } else {
    drawCloak(ctx, costume, cloth, cloakRot);
    drawLeg(ctx, -8, rLeg, cloth);
    drawLeg(ctx, 8, lLeg, cloth);
    drawArm(
      ctx,
      -15,
      lArm,
      cloth,
      skin,
      state === 'voting' ? 'paddle' : state === 'ready' ? 'sealed-note' : null,
    );
    drawTorso(ctx, costume, cloth);
    drawArm(ctx, 15, rArm, cloth, skin, state === 'applauding' ? 'clap' : accessoryHeld(o));
  }

  // ── head ────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(hx, hy - (ghost ? 4 : 0));
  drawHead(ctx, costume, skin, cloth, state, o.t, phase, hairRot, o.reduceMotion);
  ctx.restore();

  // ── firelight wash from below ───────────────────────────────────────────
  if (light > 0.02) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.55, light) * (o.away ? 0.3 : 1);
    const glow = ctx.createRadialGradient(0, -30, 4, 0, -20, 80);
    glow.addColorStop(0, theme.palette.ember);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(-60, -140, 120, 150);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (state === 'passed') drawPassFog(ctx, o.t, phase, o.reduceMotion);

  ctx.restore();
}

// ── body parts ────────────────────────────────────────────────────────────

function stroke(ctx: CanvasRenderingContext2D, width = 2.6) {
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawTorso(ctx: CanvasRenderingContext2D, costume: string, cloth: string) {
  ctx.beginPath();
  ctx.moveTo(-15, -46);
  ctx.quadraticCurveTo(-17, -74, -13, -86);
  ctx.lineTo(13, -86);
  ctx.quadraticCurveTo(17, -74, 15, -46);
  ctx.closePath();
  ctx.fillStyle = cloth;
  ctx.fill();
  stroke(ctx);

  // Belt
  ctx.beginPath();
  ctx.rect(-15, -52, 30, 7);
  ctx.fillStyle = '#241A22';
  ctx.fill();
  stroke(ctx, 1.6);

  if (costume === 'skull') {
    // Ribs, painted on.
    ctx.strokeStyle = mix('#E8E0CE', cloth, 0.3);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-9, -78 + i * 8);
      ctx.quadraticCurveTo(0, -74 + i * 8, 9, -78 + i * 8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, -84);
    ctx.lineTo(0, -56);
    ctx.stroke();
  }

  if (costume === 'mummy') {
    ctx.strokeStyle = 'rgba(20,14,24,0.35)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-15, -80 + i * 8);
      ctx.lineTo(15, -76 + i * 8);
      ctx.stroke();
    }
  }
}

/**
 * What a hand is holding.
 *
 * The first three are game state — voting, having answered, applauding — and
 * always win. The rest are the player's chosen accessory, which is decoration
 * and gives way, because the room reading the round matters more than someone
 * keeping hold of their raven.
 */
type Held = 'paddle' | 'sealed-note' | 'clap' | 'candle' | 'lantern' | 'raven' | 'broom' | null;

function drawArm(
  ctx: CanvasRenderingContext2D,
  shoulderX: number,
  rotation: number,
  cloth: string,
  skin: string,
  held: Held,
) {
  ctx.save();
  ctx.translate(shoulderX, -82);
  ctx.rotate(rad(rotation));

  ctx.beginPath();
  ctx.roundRect(-4.5, 0, 9, 30, 4.5);
  ctx.fillStyle = cloth;
  ctx.fill();
  stroke(ctx, 2.2);

  ctx.beginPath();
  ctx.arc(0, 33, 6, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  stroke(ctx, 2);

  // A voting paddle, so a silent vote is still visible across the fire.
  if (held === 'paddle') {
    ctx.beginPath();
    ctx.roundRect(-9, 36, 18, 14, 3);
    ctx.fillStyle = '#EFE6D6';
    ctx.fill();
    stroke(ctx, 2);
  }

  if (held === 'sealed-note') {
    const glow = ctx.createRadialGradient(0, 42, 1, 0, 42, 18);
    glow.addColorStop(0, 'rgba(240,168,60,0.55)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 42, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(-9, 34, 18, 15, 3);
    ctx.fillStyle = '#EFE6D6';
    ctx.fill();
    stroke(ctx, 1.8);
    ctx.strokeStyle = '#B9761F';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-5, 40);
    ctx.lineTo(5, 40);
    ctx.moveTo(-4, 44);
    ctx.lineTo(4, 44);
    ctx.stroke();
  }

  if (held === 'candle' || held === 'lantern') {
    const glow = ctx.createRadialGradient(0, 40, 1, 0, 40, held === 'lantern' ? 26 : 18);
    glow.addColorStop(0, 'rgba(240,168,60,0.5)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 40, held === 'lantern' ? 26 : 18, 0, Math.PI * 2);
    ctx.fill();

    if (held === 'candle') {
      ctx.beginPath();
      ctx.roundRect(-2.5, 36, 5, 13, 1);
      ctx.fillStyle = '#EFE6D6';
      ctx.fill();
      stroke(ctx, 1.4);
      ctx.beginPath();
      ctx.ellipse(0, 32, 3, 5.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD98A';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-7, 36, 14, 16, 2);
      ctx.fillStyle = '#3A2E1E';
      ctx.fill();
      stroke(ctx, 1.6);
      ctx.beginPath();
      ctx.rect(-4, 39, 8, 10);
      ctx.fillStyle = '#FFD98A';
      ctx.fill();
    }
  }

  if (held === 'raven') {
    ctx.beginPath();
    ctx.ellipse(2, 30, 9, 6, rad(-12), 0, Math.PI * 2);
    ctx.fillStyle = '#15121A';
    ctx.fill();
    stroke(ctx, 1.4);
    ctx.beginPath();
    ctx.arc(10, 25, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#15121A';
    ctx.fill();
    stroke(ctx, 1.2);
    ctx.beginPath();
    ctx.moveTo(13, 25);
    ctx.lineTo(19, 27);
    ctx.lineTo(13, 28);
    ctx.closePath();
    ctx.fillStyle = '#C9863C';
    ctx.fill();
  }

  if (held === 'broom') {
    ctx.beginPath();
    ctx.roundRect(-1.8, -8, 3.6, 62, 1.8);
    ctx.fillStyle = '#6B4A2A';
    ctx.fill();
    stroke(ctx, 1.4);
    ctx.beginPath();
    ctx.moveTo(-8, 52);
    ctx.lineTo(8, 52);
    ctx.lineTo(5, 66);
    ctx.lineTo(-5, 66);
    ctx.closePath();
    ctx.fillStyle = '#B08543';
    ctx.fill();
    stroke(ctx, 1.4);
  }

  if (held === 'clap') {
    ctx.strokeStyle = '#F0A83C';
    ctx.lineWidth = 1.6;
    for (const [sx, sy, ex, ey] of [
      [-11, 26, -18, 18],
      [-7, 22, -8, 12],
      [8, 22, 9, 12],
    ] as [number, number, number, number][]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, hipX: number, rotation: number, cloth: string) {
  ctx.save();
  ctx.translate(hipX, -46);
  ctx.rotate(rad(rotation));

  ctx.beginPath();
  ctx.roundRect(-5.5, 0, 11, 40, 5);
  ctx.fillStyle = shade(cloth, -0.45);
  ctx.fill();
  stroke(ctx, 2.2);

  ctx.beginPath();
  ctx.ellipse(1, 42, 8, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#191219';
  ctx.fill();
  stroke(ctx, 1.8);

  ctx.restore();
}

/** Witch and vampire cloaks, trailing one frame behind the body. */
function drawCloak(
  ctx: CanvasRenderingContext2D,
  costume: string,
  cloth: string,
  rotation: number,
) {
  if (costume !== 'witch' && costume !== 'vampire') return;

  ctx.save();
  ctx.translate(0, -86);
  ctx.rotate(rad(rotation * 0.6));

  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.quadraticCurveTo(-30, 28, -22, 54);
  ctx.lineTo(22, 54);
  ctx.quadraticCurveTo(30, 28, 14, 0);
  ctx.closePath();
  ctx.fillStyle = shade(cloth, costume === 'vampire' ? -0.68 : -0.6);
  ctx.fill();
  stroke(ctx, 2.2);

  if (costume === 'vampire') {
    // Blood-red lining, just visible at the hem.
    ctx.beginPath();
    ctx.moveTo(-20, 50);
    ctx.quadraticCurveTo(0, 58, 20, 50);
    ctx.strokeStyle = '#8B2635';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  ctx.restore();
}

/** A sheet ghost has no legs — it hovers, and the hem ripples. */
/**
 * Every costume must show `look.top` on a large shape and `look.body` somewhere
 * the eye lands.
 *
 * Half of them used to hardcode their colours, so a quarter of players opened
 * the customiser, pressed Skin or Colour, and watched nothing happen. A costume
 * you cannot colour is not a costume — it is a skin the player is not allowed
 * to own.
 */
function drawGhostBody(
  ctx: CanvasRenderingContext2D,
  cloth: string,
  skin: string,
  rotation: number,
) {
  ctx.save();
  ctx.rotate(rad(rotation * 0.4));

  ctx.beginPath();
  ctx.moveTo(-22, -6);
  ctx.quadraticCurveTo(-26, -70, 0, -78);
  ctx.quadraticCurveTo(26, -70, 22, -6);
  // Rippling hem
  ctx.quadraticCurveTo(16, 2, 11, -6);
  ctx.quadraticCurveTo(5, 2, 0, -6);
  ctx.quadraticCurveTo(-5, 2, -11, -6);
  ctx.quadraticCurveTo(-16, 2, -22, -6);
  ctx.closePath();
  ctx.fillStyle = mix('#DCD6C8', cloth, 0.24);
  ctx.fill();
  stroke(ctx);

  ctx.globalAlpha *= 0.5;
  ctx.beginPath();
  ctx.ellipse(8, -40, 5, 16, rad(12), 0, Math.PI * 2);
  ctx.fillStyle = shade(cloth, 0.2);
  ctx.fill();
  ctx.globalAlpha /= 0.5;

  // Hands. Without them a ghost cannot hold a sealed note or raise a voting
  // paddle, so the two postures the room reads to know who has acted were
  // invisible on roughly one player in eight.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 21, -34, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    stroke(ctx);
  }

  ctx.restore();
}

function drawPassFog(
  ctx: CanvasRenderingContext2D,
  t: number,
  phase: number,
  reduceMotion?: boolean,
) {
  const drift = reduceMotion ? 0 : Math.sin(t * 0.55 + phase) * 4;

  ctx.save();
  ctx.globalAlpha = 0.72;
  for (let i = 0; i < 3; i += 1) {
    const y = -55 + i * 17;
    const r = 25 + i * 5;
    const fog = ctx.createRadialGradient(drift - 8, y, 4, drift - 8, y, r);
    fog.addColorStop(0, 'rgba(205,216,230,0.16)');
    fog.addColorStop(1, 'transparent');
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.ellipse(drift - 8 + i * 8, y, r * 1.2, r * 0.42, rad(i * 10), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── head and face ─────────────────────────────────────────────────────────

function drawHead(
  ctx: CanvasRenderingContext2D,
  costume: string,
  skin: string,
  cloth: string,
  state: CharState,
  t: number,
  phase: number,
  hairRot: number,
  reduceMotion?: boolean,
) {
  const cy = -104;

  if (costume === 'ghost') {
    ctx.beginPath();
    ctx.ellipse(0, cy + 6, 19, 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#DCD6C8';
    ctx.fill();
    stroke(ctx);
    drawGhostFace(ctx, cy + 6, state);
    return;
  }

  if (costume === 'pumpkin') {
    drawPumpkinHead(ctx, cy, cloth, state, t, phase, reduceMotion);
    return;
  }

  // Hair or hood behind the face, lagging the body.
  ctx.save();
  ctx.rotate(rad(hairRot * 0.5));
  if (costume === 'hood') {
    ctx.beginPath();
    ctx.arc(0, cy, 22, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(20, cy + 14);
    ctx.lineTo(-20, cy + 14);
    ctx.closePath();
    ctx.fillStyle = shade(cloth, -0.55);
    ctx.fill();
    stroke(ctx);
  } else if (costume !== 'skull' && costume !== 'mummy') {
    ctx.beginPath();
    ctx.ellipse(0, cy - 9, 19, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#241A1E';
    ctx.fill();
  }
  ctx.restore();

  // Face
  ctx.beginPath();
  ctx.ellipse(0, cy, 17, 16.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = costume === 'skull' ? mix('#E8E0CE', skin, 0.3) : skin;
  ctx.fill();
  stroke(ctx);

  if (costume === 'skull') drawSkullFace(ctx, cy, state);
  else drawFace(ctx, cy, state, t, phase, costume, reduceMotion);

  drawHeadgear(ctx, costume, cy, cloth);
}

function blinking(t: number, phase: number, reduceMotion?: boolean) {
  if (reduceMotion) return false;
  // Irregular cycle, so a crowd never blinks in unison.
  return ((t * 0.85 + phase * 0.37) % 4.2) > 4.05;
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  cy: number,
  state: CharState,
  t: number,
  phase: number,
  costume: string,
  reduceMotion?: boolean,
) {
  const wide = state === 'shocked' || state === 'nervous';
  const squeezed = state === 'laughing' || state === 'applauding';
  const shut = blinking(t, phase, reduceMotion) || squeezed;

  const browColour = costume === 'mummy' ? '#B9AE97' : '#241A1E';

  // Eyes
  for (const ex of [-6.5, 6.5]) {
    if (shut) {
      ctx.beginPath();
      ctx.moveTo(ex - 4.5, cy - 2);
      ctx.quadraticCurveTo(ex, cy + (squeezed ? -5 : 1), ex + 4.5, cy - 2);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      ctx.stroke();
      continue;
    }

    ctx.beginPath();
    ctx.ellipse(ex, cy - 2, wide ? 5.6 : 4.8, wide ? 6.2 : 5.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = EYE_WHITE;
    ctx.fill();
    stroke(ctx, 1.8);

    // Pupil drifts a little, so nobody stares dead ahead forever.
    const drift = reduceMotion ? 0 : Math.sin(t * 0.5 + phase) * 1.1;
    ctx.beginPath();
    ctx.arc(ex + drift, cy - 1.6, wide ? 1.9 : 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#140F16';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex + drift - 1, cy - 3, 0.9, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }

  // Brows carry most of the expression
  ctx.strokeStyle = browColour;
  ctx.lineWidth = 2.4;
  const browY = cy - 10;
  if (state === 'shocked' || state === 'nervous') {
    ctx.beginPath();
    ctx.moveTo(-11, browY - 1);
    ctx.quadraticCurveTo(-6.5, browY - 5, -2, browY - 2);
    ctx.moveTo(2, browY - 2);
    ctx.quadraticCurveTo(6.5, browY - 5, 11, browY - 1);
    ctx.stroke();
  } else if (state === 'ready') {
    ctx.beginPath();
    ctx.moveTo(-11, browY - 2);
    ctx.lineTo(-2, browY - 3);
    ctx.moveTo(2, browY - 3);
    ctx.lineTo(11, browY - 2);
    ctx.stroke();
  } else if (state === 'passed') {
    ctx.beginPath();
    ctx.moveTo(-11, browY - 2);
    ctx.lineTo(-2, browY + 1);
    ctx.moveTo(2, browY + 1);
    ctx.lineTo(11, browY - 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-11, browY);
    ctx.lineTo(-2, browY - 1);
    ctx.moveTo(2, browY - 1);
    ctx.lineTo(11, browY);
    ctx.stroke();
  }

  drawMouth(ctx, cy, state, t, phase, reduceMotion);
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  cy: number,
  state: CharState,
  t: number,
  phase: number,
  reduceMotion?: boolean,
) {
  const my = cy + 8;
  ctx.strokeStyle = '#5A2B2B';
  ctx.lineWidth = 2.2;
  ctx.beginPath();

  switch (state) {
    case 'speaking': {
      const open = reduceMotion ? 3 : 1.6 + Math.abs(Math.sin(t * 7 + phase)) * 3.6;
      ctx.ellipse(0, my, 4.6, open, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3A1620';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'laughing':
      ctx.arc(0, my - 2, 6.5, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.fillStyle = '#3A1620';
      ctx.fill();
      ctx.stroke();
      return;
    case 'shocked':
      ctx.ellipse(0, my, 3.6, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3A1620';
      ctx.fill();
      ctx.stroke();
      return;
    case 'nervous': {
      const wobble = reduceMotion ? 0 : Math.sin(t * 12 + phase) * 1.2;
      ctx.moveTo(-5.5, my + 1);
      ctx.quadraticCurveTo(-2, my - 1 + wobble, 0, my + 1);
      ctx.quadraticCurveTo(2, my + 3 - wobble, 5.5, my + 1);
      ctx.stroke();
      return;
    }
    case 'passed':
      ctx.moveTo(-4.5, my + 1);
      ctx.quadraticCurveTo(0, my - 1.5, 4.5, my + 1);
      ctx.stroke();
      return;
    case 'ready':
    case 'applauding':
    case 'winner':
      ctx.arc(0, my - 3, 7, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
      return;
    default:
      ctx.arc(0, my - 2, 5, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
  }
}

function drawGhostFace(ctx: CanvasRenderingContext2D, cy: number, state: CharState) {
  // Hollow sockets, no whites — a sheet has holes, not eyes.
  ctx.fillStyle = '#160F1A';
  for (const ex of [-6.5, 6.5]) {
    ctx.beginPath();
    ctx.ellipse(ex, cy - 2, state === 'shocked' ? 4.4 : 3.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, cy + 8, state === 'speaking' ? 3.4 : 2.6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSkullFace(ctx: CanvasRenderingContext2D, cy: number, state: CharState) {
  ctx.fillStyle = '#171018';
  for (const ex of [-6.5, 6.5]) {
    ctx.beginPath();
    ctx.ellipse(ex, cy - 2, 5, 5.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // A pinprick of light, so a skull can still look at you.
    ctx.beginPath();
    ctx.arc(ex, cy - 2, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#F0A83C';
    ctx.fill();
    ctx.fillStyle = '#171018';
  }

  ctx.beginPath();
  ctx.moveTo(0, cy + 2);
  ctx.lineTo(-2.4, cy + 6);
  ctx.lineTo(2.4, cy + 6);
  ctx.closePath();
  ctx.fill();

  // Teeth
  ctx.strokeStyle = '#171018';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-8, cy + 10);
  ctx.lineTo(8, cy + 10);
  ctx.stroke();
  for (let i = -6; i <= 6; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, cy + 10);
    ctx.lineTo(i, cy + (state === 'speaking' ? 15 : 13));
    ctx.stroke();
  }
}

function drawPumpkinHead(
  ctx: CanvasRenderingContext2D,
  cy: number,
  cloth: string,
  state: CharState,
  t: number,
  phase: number,
  reduceMotion?: boolean,
) {
  ctx.beginPath();
  ctx.ellipse(0, cy, 20, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = mix('#C4642A', cloth, 0.34);
  ctx.fill();
  stroke(ctx);

  // Ribs
  ctx.strokeStyle = 'rgba(20,10,4,0.28)';
  ctx.lineWidth = 1.6;
  for (const rx of [-10, 0, 10]) {
    ctx.beginPath();
    ctx.ellipse(rx, cy, 5, 17, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Stalk
  ctx.beginPath();
  ctx.moveTo(0, cy - 17);
  ctx.quadraticCurveTo(3, cy - 24, -2, cy - 27);
  ctx.strokeStyle = '#4E6B34';
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Carved face, lit from inside
  const flicker = reduceMotion ? 1 : 0.82 + Math.sin(t * 6 + phase) * 0.18;
  ctx.fillStyle = `rgba(255, 196, 92, ${flicker})`;

  for (const ex of [-7, 7]) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, cy - 6);
    ctx.lineTo(ex + 5, cy - 4);
    ctx.lineTo(ex, cy + 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(-3, cy + 5);
  ctx.lineTo(3, cy + 5);
  ctx.closePath();
  ctx.fill();

  // Grin — wider when they're enjoying themselves
  const grin = state === 'laughing' || state === 'winner' ? 11 : 9;
  ctx.beginPath();
  ctx.moveTo(-grin, cy + 8);
  ctx.lineTo(-grin + 3, cy + 13);
  ctx.lineTo(-2, cy + 9);
  ctx.lineTo(2, cy + 13);
  ctx.lineTo(grin - 3, cy + 9);
  ctx.lineTo(grin, cy + 8);
  ctx.quadraticCurveTo(0, cy + 17, -grin, cy + 8);
  ctx.closePath();
  ctx.fill();
}

function drawHeadgear(
  ctx: CanvasRenderingContext2D,
  costume: string,
  cy: number,
  cloth: string,
) {
  switch (costume) {
    case 'witch': {
      ctx.beginPath();
      ctx.ellipse(0, cy - 15, 26, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#231733';
      ctx.fill();
      stroke(ctx);
      ctx.beginPath();
      ctx.moveTo(-13, cy - 16);
      ctx.quadraticCurveTo(-6, cy - 40, 7, cy - 52);
      ctx.quadraticCurveTo(9, cy - 32, 13, cy - 16);
      ctx.closePath();
      ctx.fillStyle = shade(cloth, -0.5);
      ctx.fill();
      stroke(ctx);
      ctx.beginPath();
      ctx.rect(-13, cy - 21, 26, 5);
      ctx.fillStyle = '#F0A83C';
      ctx.fill();
      stroke(ctx, 1.6);
      break;
    }

    case 'vampire': {
      // Widow's peak plus a stiff collar.
      ctx.beginPath();
      ctx.moveTo(-17, cy - 8);
      ctx.quadraticCurveTo(-14, cy - 20, 0, cy - 18);
      ctx.quadraticCurveTo(14, cy - 20, 17, cy - 8);
      ctx.lineTo(9, cy - 12);
      ctx.lineTo(0, cy - 6);
      ctx.lineTo(-9, cy - 12);
      ctx.closePath();
      ctx.fillStyle = '#140D16';
      ctx.fill();
      stroke(ctx, 2);
      break;
    }

    case 'mummy': {
      ctx.strokeStyle = mix('#E8E0CE', cloth, 0.2);
      ctx.lineWidth = 5;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-17, cy - 12 + i * 9);
        ctx.lineTo(17, cy - 15 + i * 9);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(20,14,24,0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-17, cy - 12 + i * 9);
        ctx.lineTo(17, cy - 15 + i * 9);
        ctx.stroke();
      }
      break;
    }

    case 'devil': {
      ctx.fillStyle = '#8B2635';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 10, cy - 14);
        ctx.quadraticCurveTo(s * 20, cy - 22, s * 15, cy - 34);
        ctx.quadraticCurveTo(s * 11, cy - 22, s * 5, cy - 15);
        ctx.closePath();
        ctx.fill();
        stroke(ctx, 2);
      }
      break;
    }

    case 'hood':
    case 'skull':
    case 'none':
      break;

    default: {
      // Anything else reads as a simple hat, in their own colour.
      ctx.beginPath();
      ctx.arc(0, cy - 12, 17, Math.PI, Math.PI * 2);
      ctx.rect(-17, cy - 12, 34, 4);
      ctx.fillStyle = shade(cloth, -0.2);
      ctx.fill();
      stroke(ctx, 2.2);
    }
  }
}

// ── nameplate ─────────────────────────────────────────────────────────────

/** The accessory the player chose, as something a hand can hold. */
function accessoryHeld(o: DrawCharacterOptions): Held {
  const list = o.theme.accessories;
  const name = list[o.look.accessory % list.length];
  return name === 'candle' || name === 'lantern' || name === 'raven' || name === 'broom'
    ? name
    : null;
}

/**
 * How far above the feet the tallest part of a costume reaches, unscaled.
 *
 * A witch's cone and a devil's horns sit far above a plain head, so anything
 * drawn "above the character" needs to ask rather than assume — otherwise the
 * badge lands on the hat of the tall costumes and floats away from the short
 * ones.
 */
const COSTUME_TOP: Record<string, number> = {
  witch: 158,
  devil: 140,
  pumpkin: 133,
  mummy: 128,
  ghost: 124,
};

export function headTop(theme: Theme, look: CharacterLook): number {
  const costume = theme.toppers[look.topper % theme.toppers.length];
  return COSTUME_TOP[costume] ?? 122;
}

/**
 * "I'm done" — a sealed note or a lit candle, floating above the head.
 *
 * The posture already says this, but a posture is a few pixels of arm angle
 * and this has to read across a ring of nine at the far end of a screen-share
 * that has been re-encoded twice.
 */
export function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  mark: 'sealed' | 'voted' | 'waiting',
  theme: Theme,
  top: number,
  t = 0,
  reduceMotion = false,
) {
  const cy = y - (top + 20) * scale;
  const s = Math.max(1.15, scale);

  ctx.save();
  ctx.translate(x, cy);
  ctx.scale(s, s);

  // Still thinking: a small bubble of dots that fill in turn. This is the
  // half that was missing — the scene could say who had finished but not who
  // the room was waiting for, which is the thing a host actually looks for.
  if (mark === 'waiting') {
    ctx.beginPath();
    ctx.roundRect(-15, -10, 30, 20, 9);
    ctx.fillStyle = 'rgba(18,13,24,0.9)';
    ctx.fill();
    ctx.strokeStyle = `${theme.palette.edge}`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // The little tail, so it reads as a thought rather than a badge.
    ctx.beginPath();
    ctx.arc(-3, 10, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,13,24,0.9)';
    ctx.fill();

    for (let i = 0; i < 3; i += 1) {
      const lit = reduceMotion ? 0.6 : 0.28 + 0.72 * (0.5 + 0.5 * Math.sin(t * 3 - i * 0.9));
      ctx.beginPath();
      ctx.arc(-7 + i * 7, 0, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = `${theme.palette.muted}${Math.round(lit * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // A warm halo so it separates from the trees behind it.
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
  glow.addColorStop(0, `${theme.palette.ember}66`);
  glow.addColorStop(1, `${theme.palette.ember}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(-16, -16, 32, 32);

  if (mark === 'sealed') {
    ctx.beginPath();
    ctx.roundRect(-7, -6, 14, 12, 1.5);
    ctx.fillStyle = '#EFE0BF';
    ctx.fill();
    ctx.strokeStyle = '#8B5A2B';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // A wax blob, because a sealed answer is the whole point.
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = theme.palette.alert;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.roundRect(-2.5, -3, 5, 11, 1);
    ctx.fillStyle = '#F3E0BD';
    ctx.fill();
    ctx.strokeStyle = '#8B5A2B';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -7, 3, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = theme.palette.ember;
    ctx.fill();
  }

  ctx.restore();
}

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
  const top = y + 9 * scale;

  ctx.beginPath();
  ctx.roundRect(x - width / 2, top, width, height, 3);
  ctx.fillStyle = highlight ? theme.palette.ember : 'rgba(14,9,18,0.9)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = highlight ? theme.palette.ember : 'rgba(255,255,255,0.1)';
  ctx.stroke();

  ctx.fillStyle = highlight ? '#1A1206' : theme.palette.text;
  ctx.fillText(name, x, top + height / 2);
}

// ── helpers ───────────────────────────────────────────────────────────────

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/**
 * Lighten (positive) or darken (negative) a hex colour.
 *
 * Returns hex, not `rgb(...)`, so callers can append an alpha pair the way the
 * scene code already does elsewhere.
 */
function shade(hex: string, amount: number): string {
  const [r, g, b] = rgbOf(hex);
  return `#${hex2(r * (1 + amount))}${hex2(g * (1 + amount))}${hex2(b * (1 + amount))}`;
}

/** Blend `a` toward `b`; `k` is how much of `b`. Hex in, hex out. */
function mix(a: string, b: string, k: number): string {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return `#${hex2(ar + (br - ar) * k)}${hex2(ag + (bg - ag) * k)}${hex2(ab + (bb - ab) * k)}`;
}
