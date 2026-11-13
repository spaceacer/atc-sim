// Racetrack holding pattern, simplified:
//   entry    fly direct to the hold point (skipped when holding "here")
//   turnOut  180° turn in the hold direction to the outbound heading
//   outbound fly 1 minute
//   turnIn   180° turn in the hold direction back toward the inbound course
//   inbound  track the inbound course to the hold point, then turnOut again
// Two 180° turns at the same rate bring the aircraft back onto the inbound
// course, so no wind-free entry procedures are needed.

import type { Aircraft, HoldState } from '../types.js';
import { bearing, distance, headingDiff, normHeading, runwayRelative } from '../geometry.js';

export const HOLD_LEG_SEC = 60;
const FIX_CAPTURE_NM = 0.8;
const FIX_BEHIND_NM = 3;
const TRACK_GAIN = 60; // degrees per nm off course
const MAX_CORRECTION = 40;
/** Switch from the forced inbound turn to course tracking this many degrees early. */
const TURN_IN_HANDOVER = 30;

export function startHold(
  ac: Aircraft,
  point: { x: number; y: number },
  fix: string | null,
  turn: 'L' | 'R',
): HoldState {
  const here = fix === null;
  const inbound = here ? ac.heading : bearing(ac.x, ac.y, point.x, point.y);
  const hold: HoldState = {
    fix,
    x: point.x,
    y: point.y,
    inbound: normHeading(inbound),
    turn,
    phase: here ? 'turnOut' : 'entry',
    timer: 0,
  };
  ac.lateralMode = 'hold';
  ac.hold = hold;
  ac.route = [];
  ac.turnDirection = null;
  return hold;
}

/** Steer one aircraft around its hold. Call before integration. */
export function updateHoldGuidance(ac: Aircraft, dt: number): void {
  const h = ac.hold;
  if (ac.lateralMode !== 'hold' || !h) return;
  const outbound = normHeading(h.inbound + 180);

  if (h.phase === 'entry') {
    const d = distance(ac.x, ac.y, h.x, h.y);
    const brg = bearing(ac.x, ac.y, h.x, h.y);
    const behind = Math.abs(headingDiff(ac.heading, brg)) > 90;
    if (d < FIX_CAPTURE_NM || (behind && d < FIX_BEHIND_NM)) {
      h.phase = 'turnOut';
    } else {
      ac.targetHeading = brg;
      ac.turnDirection = null;
      return;
    }
  }

  switch (h.phase) {
    case 'turnOut':
      ac.targetHeading = outbound;
      ac.turnDirection = h.turn;
      if (Math.abs(headingDiff(ac.heading, outbound)) < 1) {
        h.phase = 'outbound';
        h.timer = Math.round(HOLD_LEG_SEC / dt);
      }
      break;
    case 'outbound':
      ac.targetHeading = outbound;
      ac.turnDirection = null;
      if (--h.timer <= 0) h.phase = 'turnIn';
      break;
    case 'turnIn':
      ac.targetHeading = h.inbound;
      ac.turnDirection = h.turn;
      if (Math.abs(headingDiff(ac.heading, h.inbound)) <= TURN_IN_HANDOVER) h.phase = 'inbound';
      break;
    case 'inbound': {
      const rel = runwayRelative(ac.x, ac.y, h.x, h.y, h.inbound);
      const corr = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, -rel.crossTrack * TRACK_GAIN));
      ac.targetHeading = normHeading(h.inbound + corr);
      ac.turnDirection = null;
      if (rel.alongTrack <= 0) h.phase = 'turnOut';
      break;
    }
  }
}
