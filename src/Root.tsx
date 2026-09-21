/*
 * The Last Screen Standing is the only game this deployment serves.
 *
 * Campfire (the original party-game engine) was pulled from the site and
 * lives in archive/campfire/ — not wired into the build, not typechecked,
 * not deployed. This file used to branch on the URL between the two; now it
 * always loads survival.
 */
export { default as Root } from './survival/Survival.tsx'
