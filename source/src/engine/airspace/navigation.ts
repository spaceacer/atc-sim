// Direct-to and simple routes: fly to route[0], then the next fix.
// After the last fix the aircraft keeps its heading (as in ATC-SIM).

import type { Aircraft, Airport } from '../types.js';
import { bearing, distance, headingDiff } from '../geometry.js';
import { findFix } from './airport.js';

/** A fix counts as passed inside this distance, nm. */
const FIX_CAPTURE_NM = 0.8;
/** ...or once it is behind the aircraft and this close (avoids orbiting a fix inside the turn radius). */
const FIX_BEHIND_NM = 3;

/** Steer toward the active fix. Returns the name of a fix passed this tick, or null. */
export function updateDirectGuidance(ac: Aircraft, airport: Airport): string | null {
  if (ac.lateralMode !== 'direct') return null;
  let passed: string | null = null;
  while (ac.route.length > 0) {
    const fix = findFix(airport, ac.route[0]);
    if (!fix) {
      ac.route.shift();
      continue;
    }
    const d = distance(ac.x, ac.y, fix.x, fix.y);
    const brg = bearing(ac.x, ac.y, fix.x, fix.y);
    const behind = Math.abs(headingDiff(ac.heading, brg)) > 90;
    if (d < FIX_CAPTURE_NM || (behind && d < FIX_BEHIND_NM && ac.turnAltitude === 0)) {
      passed = ac.route.shift() ?? null;
      continue;
    }
    ac.targetHeading = brg;
    ac.turnDirection = null;
    return passed;
  }
  ac.lateralMode = 'heading';
  ac.targetHeading = ac.heading;
  return passed;
}
