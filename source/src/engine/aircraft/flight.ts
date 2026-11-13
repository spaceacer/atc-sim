// Kinematic integration: moves an aircraft toward its targets with rate limits.
// Guidance (approach.ts) sets targets; this file only turns, climbs, accelerates
// and moves. Mutates the aircraft in place (no allocation in the tick loop).

import type { Aircraft } from '../types.js';
import type { Performance } from './performance.js';
import { headingDiff, normHeading } from '../geometry.js';

const DEG = Math.PI / 180;

/** How fast the vertical speed changes when starting or ending a climb or descent, ft/min per second. */
export const VS_CHANGE_PER_SEC = 250;
/** Expedite multiplies the normal rate by this, up to EXPEDITE_MAX_FPM. */
export const EXPEDITE_FACTOR = 1.5;
export const EXPEDITE_MAX_FPM = 3000;
/** Approaching the target altitude the rate is limited to this many ft/min per ft left (a smooth level-off). */
const LEVEL_OFF_PER_FT = 6;
const MIN_LEVEL_OFF_FPM = 300;

export function integrate(ac: Aircraft, perf: Performance, dt: number): void {
  // --- Heading -------------------------------------------------------------
  // After takeoff the aircraft holds runway heading until turnAltitude.
  if (ac.turnAltitude > 0 && ac.altitude >= ac.turnAltitude) ac.turnAltitude = 0;
  const diff = headingDiff(ac.heading, ac.targetHeading);
  if (ac.turnAltitude > 0) {
    // Climbing out on runway heading; the assigned turn starts at turnAltitude.
  } else if (diff !== 0) {
    let dir: number;
    if (ac.turnDirection === 'R') dir = 1;
    else if (ac.turnDirection === 'L') dir = -1;
    else dir = diff > 0 ? 1 : -1;

    // Degrees left to turn in the chosen direction, in [0, 360).
    const remaining = dir > 0 ? (diff + 360) % 360 : (-diff + 360) % 360;
    const step = perf.turnRate * dt;
    if (remaining <= step) {
      ac.heading = normHeading(ac.targetHeading);
      ac.turnDirection = null;
    } else {
      ac.heading = normHeading(ac.heading + dir * step);
    }
  } else {
    ac.turnDirection = null;
  }

  // --- Speed ---------------------------------------------------------------
  const dv = ac.targetSpeed - ac.speed;
  if (dv > 0) ac.speed = Math.min(ac.targetSpeed, ac.speed + perf.accel * dt);
  else if (dv < 0) ac.speed = Math.max(ac.targetSpeed, ac.speed - perf.decel * dt);

  // --- Altitude ------------------------------------------------------------
  // The vertical speed eases in (VS_CHANGE_PER_SEC) and eases off near the
  // target, like a pilot pushing over and levelling off. On the glidepath the
  // target moves continuously, so the aircraft follows it directly.
  const dh = ac.targetAltitude - ac.altitude;
  if (dh === 0) {
    ac.verticalSpeed = 0;
  } else {
    const normal = dh > 0 ? perf.climbRate : perf.descentRate;
    const rate = ac.expedite ? Math.min(EXPEDITE_MAX_FPM, Math.max(normal, normal * EXPEDITE_FACTOR)) : normal;
    const onGlidepath = ac.lateralMode === 'localizer' && dh < 0;
    let target = Math.sign(dh) * Math.min(rate, Math.max(MIN_LEVEL_OFF_FPM, Math.abs(dh) * LEVEL_OFF_PER_FT));
    if (onGlidepath) target = -rate;
    const step = VS_CHANGE_PER_SEC * dt;
    const sameWay = Math.sign(ac.verticalSpeed) === Math.sign(target);
    if (sameWay && Math.abs(target) <= Math.abs(ac.verticalSpeed)) {
      ac.verticalSpeed = target; // levelling off: the limit shrinks smoothly with the height left
    } else if (sameWay) {
      ac.verticalSpeed = Math.sign(target) * Math.min(Math.abs(target), Math.abs(ac.verticalSpeed) + step);
    } else {
      ac.verticalSpeed = Math.sign(target) * Math.min(Math.abs(target), step); // a new climb or descent starts gently
    }
    if (onGlidepath) ac.verticalSpeed = -rate; // track the glidepath as before
    const next = ac.altitude + (ac.verticalSpeed / 60) * dt;
    ac.altitude = dh > 0 ? Math.min(ac.targetAltitude, next) : Math.max(ac.targetAltitude, next);
    if (ac.altitude === ac.targetAltitude) {
      ac.expedite = false;
      ac.verticalSpeed = 0;
    }
  }

  // --- Position ------------------------------------------------------------
  const distNm = (ac.speed / 3600) * dt;
  const h = ac.heading * DEG;
  ac.x += Math.sin(h) * distNm;
  ac.y += Math.cos(h) * distNm;
}

/** Radius of a turn at the aircraft's speed and turn rate, nm. */
export function turnRadius(speedKt: number, turnRateDegPerSec: number): number {
  return speedKt / 3600 / (turnRateDegPerSec * DEG);
}
