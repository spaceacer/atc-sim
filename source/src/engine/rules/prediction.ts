// Short-term conflict alert: extrapolate each airborne pair along current
// heading, speed and vertical rate (stopping at the cleared altitude) and warn
// when separation would be lost within the look-ahead. Same thresholds and
// tower exemption as separation.ts. No score effect: it is a warning, and an
// observation an AI controller can use.

import type { Aircraft } from '../types.js';
import { performanceOf } from '../aircraft/performance.js';
import { DEFAULT_MINIMA, TOWER_HEIGHT_FT, pairMinima, type SeparationMinima } from './separation.js';

export const LOOKAHEAD_SEC = 60;
const SAMPLE_SEC = 5;
const DEG = Math.PI / 180;
/** Upper bound on closure speed (2 x 310 kt), for a cheap distance prefilter, nm per second. */
const MAX_CLOSURE_NM_PER_SEC = 620 / 3600;

// Scratch buffers reused across calls (no allocation in the tick loop).
let vx = new Float64Array(64);
let vy = new Float64Array(64);

export interface ConflictWarning {
  a: Aircraft;
  b: Aircraft;
  inSeconds: number;
}

/**
 * Sets conflictWarning on aircraft predicted to lose separation (and not
 * already in a loss), and returns pairs whose warning started this call.
 */
export function predictConflicts(
  aircraft: readonly Aircraft[],
  activePairs: Set<string>,
  fieldElevation: number,
  minima: SeparationMinima = DEFAULT_MINIMA,
  lookaheadSec: number = LOOKAHEAD_SEC,
): ConflictWarning[] {
  for (const ac of aircraft) ac.conflictWarning = false;
  const prefilterNm = minima.lateralNm + MAX_CLOSURE_NM_PER_SEC * lookaheadSec;
  // Velocities once per aircraft, not once per pair.
  if (vx.length < aircraft.length) {
    vx = new Float64Array(aircraft.length * 2);
    vy = new Float64Array(aircraft.length * 2);
  }
  for (let k = 0; k < aircraft.length; k++) {
    const ac = aircraft[k];
    vx[k] = (Math.sin(ac.heading * DEG) * ac.speed) / 3600;
    vy[k] = (Math.cos(ac.heading * DEG) * ac.speed) / 3600;
  }
  const towerCeiling = fieldElevation + TOWER_HEIGHT_FT;
  const current = new Set<string>();
  const started: ConflictWarning[] = [];
  const n = aircraft.length;

  for (let i = 0; i < n; i++) {
    const a = aircraft[i];
    if (a.status !== 'airborne') continue;
    for (let j = i + 1; j < n; j++) {
      const b = aircraft[j];
      if (b.status !== 'airborne') continue;
      if (a.inConflict && b.inConflict) continue; // already a loss, shown as such
      if (Math.abs(a.x - b.x) > prefilterNm || Math.abs(a.y - b.y) > prefilterNm) continue;
      const t = firstConflictTime(a, b, vx[i], vy[i], vx[j], vy[j], towerCeiling, pairMinima(a, b, minima), lookaheadSec);
      if (t === null) continue;

      a.conflictWarning = true;
      b.conflictWarning = true;
      const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
      current.add(key);
      if (!activePairs.has(key)) started.push({ a, b, inSeconds: t });
    }
  }
  activePairs.clear();
  for (const k of current) activePairs.add(k);
  return started;
}

function firstConflictTime(
  a: Aircraft,
  b: Aircraft,
  avx: number,
  avy: number,
  bvx: number,
  bvy: number,
  towerCeiling: number,
  minima: SeparationMinima,
  lookaheadSec: number,
): number | null {
  // Vertical prefilter: each aircraft moves monotonically toward its cleared
  // altitude, so over the look-ahead it stays between now and altitudeAt(end).
  const aEnd = altitudeAt(a, lookaheadSec);
  const bEnd = altitudeAt(b, lookaheadSec);
  const gap = Math.max(
    Math.min(a.altitude, aEnd) - Math.max(b.altitude, bEnd),
    Math.min(b.altitude, bEnd) - Math.max(a.altitude, aEnd),
  );
  if (gap >= minima.verticalFt) return null;
  const lat2 = minima.lateralNm * minima.lateralNm;
  for (let t = SAMPLE_SEC; t <= lookaheadSec; t += SAMPLE_SEC) {
    const dx = a.x + avx * t - (b.x + bvx * t);
    const dy = a.y + avy * t - (b.y + bvy * t);
    if (dx * dx + dy * dy >= lat2) continue;
    const altA = altitudeAt(a, t);
    const altB = altitudeAt(b, t);
    if (altA < towerCeiling && altB < towerCeiling) continue;
    if (Math.abs(altA - altB) < minima.verticalFt) return t;
  }
  return null;
}

function altitudeAt(ac: Aircraft, t: number): number {
  const perf = performanceOf(ac);
  const diff = ac.targetAltitude - ac.altitude;
  if (diff === 0) return ac.altitude;
  const factor = ac.expedite ? 2 : 1;
  const rate = ((diff > 0 ? perf.climbRate : perf.descentRate) / 60) * factor;
  const change = Math.min(Math.abs(diff), rate * t);
  return ac.altitude + Math.sign(diff) * change;
}
