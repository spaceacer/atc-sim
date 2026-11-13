// Kinematic integration: moves an aircraft toward its targets with rate limits.
// Guidance (approach.ts) sets targets; this file only turns, climbs, accelerates
// and moves. Mutates the aircraft in place (no allocation in the tick loop).

import type { Aircraft } from '../types.js';
import type { Performance } from './performance.js';
import { headingDiff, normHeading } from '../geometry.js';

const DEG = Math.PI / 180;

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
  const dh = ac.targetAltitude - ac.altitude;
  if (dh !== 0) {
    const factor = ac.expedite ? 2 : 1;
    if (dh > 0) {
      ac.altitude = Math.min(ac.targetAltitude, ac.altitude + (perf.climbRate / 60) * factor * dt);
    } else {
      ac.altitude = Math.max(ac.targetAltitude, ac.altitude - (perf.descentRate / 60) * factor * dt);
    }
    if (ac.altitude === ac.targetAltitude) ac.expedite = false;
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
