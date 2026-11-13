// Straight-in approach: centreline capture, 3 degree glidepath, touchdown.
//
// Clearances: "I 27" (cleared to intercept) and "L 27" (cleared to land) both
// join the localizer, hold the assigned altitude until established, follow the
// glidepath and land. With the scenario option requireLandingClearance, I is
// the approach clearance only and L must follow by landingClearanceNm from the
// threshold, or the aircraft goes around (the real split between approach
// control and tower).
//
// Joining:
//  1. The aircraft keeps the controller's heading (the assigned one, even while
//     still turning onto it) if it meets the extended centreline at least
//     MIN_JOIN_NM before the threshold.
//  2. Otherwise (parallel, diverging, or meeting too late) it turns by itself
//     to join, at most JOIN_ANGLE degrees, like a pilot cleared for the approach.
//  3. On reaching the centreline (with a lead for its turn radius) it turns onto
//     it ("localizer captured"), tracks it, follows a 3 degree glidepath down and slows.
//  4. At the threshold it touches down if low enough (then rolls out, see
//     Simulation.landingRollout), otherwise it flies a missed approach.
//     An aircraft that reaches the threshold without having lined up goes around too.

import type { Aircraft, Airport, RunwayEnd, Wind } from '../types.js';
import type { Performance } from '../aircraft/performance.js';
import { FT_PER_NM, headingDiff, normHeading, runwayRelative } from '../geometry.js';
import { turnRadius } from '../aircraft/flight.js';
import { findRunway, tailwind } from './airport.js';

const DEG = Math.PI / 180;

/** Glidepath gradient for a 3 degree approach, feet per nm. */
export const GLIDEPATH_FT_PER_NM = Math.tan(3 * DEG) * FT_PER_NM;

/** Centreline must be met within this distance of the threshold, nm. */
export const MAX_CAPTURE_RANGE = 30;
/** Landing clearance limits, as in ATC-SIM. */
export const MAX_CLEARANCE_ANGLE = 60;
export const MAX_CLEARANCE_HEIGHT = 3000;
/** On final without a landing clearance by this distance from the threshold: go around, nm. */
export const LANDING_CLEARANCE_NM = 4;
/** Largest intercept angle the aircraft uses when it joins by itself, degrees. */
export const JOIN_ANGLE = 30;
/** The controller's heading is kept only if it meets the centreline at least this far out, nm. */
export const MIN_JOIN_NM = 3;
/** A new approach clearance needs the aircraft at least this far out along the approach, nm. */
const MIN_CLEARANCE_ALONG = 0.5;
/** Above this height at the threshold the aircraft goes around, ft. */
export const MAX_THRESHOLD_HEIGHT = 200;
/** Speed held on the centreline until close in, kt. */
const INTERMEDIATE_SPEED = 180;
const FINAL_SPEED_DISTANCE = 5; // nm
/** Proportional gain for centreline tracking, degrees of correction per nm off. */
const TRACK_GAIN = 60;
const MAX_TRACK_CORRECTION = 30;

export type ApproachOutcome =
  | { kind: 'none' }
  | { kind: 'captured'; runway: string }
  | { kind: 'landed'; runway: string }
  | { kind: 'missed'; runway: string; reason: string };

const NONE: ApproachOutcome = { kind: 'none' };

/** Check whether a new approach or landing clearance can be accepted right now. */
export function checkLandingClearance(
  ac: Aircraft,
  airport: Airport,
  runwayId: string,
  wind: Wind,
  inUse: readonly string[],
): { ok: true; runway: RunwayEnd } | { ok: false; reason: string } {
  if (ac.status !== 'airborne') return { ok: false, reason: 'not airborne' };
  const runway = findRunway(airport, runwayId);
  if (!runway) {
    const ids = airport.runways.map((r) => r.id).join(', ');
    return { ok: false, reason: `unknown runway ${runwayId} (available: ${ids})` };
  }
  const tw = tailwind(runway, wind);
  if (!inUse.includes(runway.id)) {
    return { ok: false, reason: `runway ${runway.id} not in use, tailwind ${Math.round(tw)} kt` };
  }
  const rel = runwayRelative(ac.x, ac.y, runway.thresholdX, runway.thresholdY, runway.heading);
  if (rel.alongTrack < MIN_CLEARANCE_ALONG) {
    return { ok: false, reason: `already past the runway ${runway.id} threshold` };
  }
  const angle = Math.abs(headingDiff(ac.heading, runway.heading));
  if (angle > MAX_CLEARANCE_ANGLE) {
    return {
      ok: false,
      reason: `heading ${fmtHeading(ac.heading)} is more than ${MAX_CLEARANCE_ANGLE}° from runway ${runway.id} (${fmtHeading(runway.heading)})`,
    };
  }
  if (ac.altitude > airport.elevation + MAX_CLEARANCE_HEIGHT + 1) {
    return {
      ok: false,
      reason: `too high: must be at or below ${airport.elevation + MAX_CLEARANCE_HEIGHT} ft`,
    };
  }
  return { ok: true, runway };
}

/**
 * Update approach guidance for one aircraft before integration.
 * Sets target heading/altitude/speed; returns a capture outcome if it happened.
 */
export function updateApproachGuidance(
  ac: Aircraft,
  airport: Airport,
  perf: Performance,
): ApproachOutcome {
  if ((ac.lateralMode !== 'approach' && ac.lateralMode !== 'localizer') || ac.runway === null) return NONE;
  const runway = findRunway(airport, ac.runway);
  if (!runway) return NONE;

  const rel = runwayRelative(ac.x, ac.y, runway.thresholdX, runway.thresholdY, runway.heading);

  if (ac.lateralMode === 'approach') {
    const prev = ac.lastCrossTrack;
    ac.lastCrossTrack = rel.crossTrack;
    if (rel.alongTrack <= MIN_CLEARANCE_ALONG || rel.alongTrack > MAX_CAPTURE_RANGE) return NONE;

    const angle = headingDiff(runway.heading, ac.heading); // + = aircraft heading right of runway
    const absAngle = Math.abs(angle);

    if (absAngle <= 90) {
      // Cross-track changes at a rate proportional to sin(angle): converging if opposite sign.
      const converging = rel.crossTrack * Math.sin(angle * DEG) < 0;
      const lead = turnRadius(ac.speed, perf.turnRate) * (1 - Math.cos(absAngle * DEG)) + 0.02;
      const crossed = prev !== null && Math.sign(prev) !== Math.sign(rel.crossTrack) && prev !== 0;
      if ((converging && Math.abs(rel.crossTrack) <= lead) || crossed || Math.abs(rel.crossTrack) < 0.02) {
        ac.lateralMode = 'localizer';
        ac.turnDirection = null;
        trackCentreline(ac, runway.heading, rel.crossTrack);
        return { kind: 'captured', runway: runway.id };
      }
    }

    // Not there yet. Keep the controller's heading if it joins in time; otherwise join by itself.
    // Judged on the assigned heading, not the present one: an aircraft still turning onto
    // an intercept heading given with the clearance ("C 225 L 27") must not be overridden.
    const assigned = headingDiff(runway.heading, ac.targetHeading);
    if (!meetsCentrelineInTime(rel.alongTrack, rel.crossTrack, assigned)) {
      ac.targetHeading = joinHeading(runway.heading, rel.crossTrack);
      ac.turnDirection = null;
    }
    return NONE;
  }

  // Established on the centreline.
  trackCentreline(ac, runway.heading, rel.crossTrack);

  const glidepathAlt = airport.elevation + Math.max(0, rel.alongTrack) * GLIDEPATH_FT_PER_NM;
  // Descend to the glidepath if above it; if below, keep the assigned altitude until it is met.
  ac.targetAltitude = Math.min(ac.targetAltitude, glidepathAlt);
  ac.expedite = false;

  const speedTarget = rel.alongTrack > FINAL_SPEED_DISTANCE ? INTERMEDIATE_SPEED : perf.approachSpeed;
  ac.targetSpeed = Math.min(ac.targetSpeed, speedTarget);
  return NONE;
}

/**
 * After integration: did the aircraft reach the threshold, and did it land?
 * Also ends approaches that cannot continue: on final without a landing
 * clearance by LANDING_CLEARANCE_NM, or past the threshold without having lined up.
 */
export function checkThreshold(ac: Aircraft, airport: Airport, landingClearanceNm: number | null = LANDING_CLEARANCE_NM): ApproachOutcome {
  if ((ac.lateralMode !== 'localizer' && ac.lateralMode !== 'approach') || ac.runway === null) return NONE;
  const runway = findRunway(airport, ac.runway);
  if (!runway) return NONE;
  const rel = runwayRelative(ac.x, ac.y, runway.thresholdX, runway.thresholdY, runway.heading);
  if (ac.lateralMode === 'approach') {
    return rel.alongTrack > 0 ? NONE : { kind: 'missed', runway: runway.id, reason: 'reached the runway without lining up' };
  }
  if (landingClearanceNm !== null && !ac.landingCleared && rel.alongTrack <= landingClearanceNm) {
    return { kind: 'missed', runway: runway.id, reason: `not cleared to land by ${landingClearanceNm} nm` };
  }
  if (rel.alongTrack > 0) return NONE;

  const height = ac.altitude - airport.elevation;
  if (height <= MAX_THRESHOLD_HEIGHT && Math.abs(rel.crossTrack) < 0.3) {
    return { kind: 'landed', runway: runway.id };
  }
  const reason = height > MAX_THRESHOLD_HEIGHT ? `too high at threshold (${Math.round(height)} ft)` : 'not aligned with runway';
  return { kind: 'missed', runway: runway.id, reason };
}

/** Put an aircraft into a missed approach: runway heading, climb to 3,000 ft. */
export function startMissedApproach(ac: Aircraft, airport: Airport, runwayHeading: number): void {
  ac.lateralMode = 'heading';
  ac.route = [];
  ac.hold = null;
  ac.runway = null;
  ac.landingCleared = false;
  ac.lastCrossTrack = null;
  ac.targetHeading = normHeading(runwayHeading);
  ac.turnDirection = null;
  ac.targetAltitude = airport.elevation + 3000;
  ac.targetSpeed = Math.max(ac.targetSpeed, 200);
}

/**
 * Does the present heading meet the extended centreline at least MIN_JOIN_NM
 * before the threshold? `angle` is the aircraft heading relative to the runway
 * heading, degrees (+ = right of it).
 */
function meetsCentrelineInTime(alongTrack: number, crossTrack: number, angle: number): boolean {
  if (Math.abs(angle) >= 90) return false; // flying away from the threshold
  const sin = Math.sin(angle * DEG);
  if (crossTrack * sin >= 0) return false; // parallel or diverging
  const flown = Math.abs(crossTrack / sin); // nm until the centreline is reached
  return alongTrack - flown * Math.cos(angle * DEG) >= MIN_JOIN_NM;
}

/** Heading that converges on the centreline, at most JOIN_ANGLE off the runway heading. */
function joinHeading(runwayHeading: number, crossTrack: number): number {
  const correction = Math.max(-JOIN_ANGLE, Math.min(JOIN_ANGLE, -crossTrack * TRACK_GAIN));
  return normHeading(runwayHeading + correction);
}

function trackCentreline(ac: Aircraft, runwayHeading: number, crossTrack: number): void {
  // Right of centreline (+) -> steer left (-).
  const correction = Math.max(-MAX_TRACK_CORRECTION, Math.min(MAX_TRACK_CORRECTION, -crossTrack * TRACK_GAIN));
  ac.targetHeading = normHeading(runwayHeading + correction);
}

function fmtHeading(h: number): string {
  return String(Math.round(normHeading(h))).padStart(3, '0');
}
