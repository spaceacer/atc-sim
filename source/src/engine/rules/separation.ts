// Separation: 3 nm lateral OR 1,000 ft vertical by default, as in ATC-SIM (Settings can change the minima).
// Airborne aircraft only. All-pairs check: O(n^2) is fine below ~200 aircraft.
// Mutates inConflict flags.

import type { Aircraft } from '../types.js';

export const MIN_LATERAL_NM = 3;
export const MIN_VERTICAL_FT = 1000;

export interface SeparationMinima {
  lateralNm: number;
  verticalFt: number;
}
export const DEFAULT_MINIMA: SeparationMinima = { lateralNm: MIN_LATERAL_NM, verticalFt: MIN_VERTICAL_FT };
/**
 * Pairs where both aircraft are below this height above the field are the
 * tower's business (a departure lifting off ahead of a landing), not radar
 * separation, so they are not counted.
 */
export const TOWER_HEIGHT_FT = 1000;

export interface SeparationLoss {
  a: Aircraft;
  b: Aircraft;
  distance: number;
  verticalFt: number;
}

/**
 * Flags every aircraft currently in a loss of separation, and returns only the
 * losses that started this tick (pairs not in `activePairs`). `activePairs` is
 * updated in place to the set of pairs currently in conflict.
 */
export function checkSeparation(
  aircraft: readonly Aircraft[],
  activePairs: Set<string>,
  fieldElevation = 0,
  minima: SeparationMinima = DEFAULT_MINIMA,
): SeparationLoss[] {
  const lat = minima.lateralNm;
  const towerCeiling = fieldElevation + TOWER_HEIGHT_FT;
  for (const ac of aircraft) ac.inConflict = false;

  const current = new Set<string>();
  const started: SeparationLoss[] = [];
  const n = aircraft.length;
  for (let i = 0; i < n; i++) {
    const a = aircraft[i];
    if (a.status !== 'airborne') continue;
    for (let j = i + 1; j < n; j++) {
      const b = aircraft[j];
      if (b.status !== 'airborne') continue;
      if (a.altitude < towerCeiling && b.altitude < towerCeiling) continue;
      const vertical = Math.abs(a.altitude - b.altitude);
      if (vertical >= minima.verticalFt) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (Math.abs(dx) >= lat || Math.abs(dy) >= lat) continue;
      const dist = Math.hypot(dx, dy);
      if (dist >= lat) continue;

      a.inConflict = true;
      b.inConflict = true;
      const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
      current.add(key);
      if (!activePairs.has(key)) started.push({ a, b, distance: dist, verticalFt: vertical });
    }
  }

  activePairs.clear();
  for (const k of current) activePairs.add(k);
  return started;
}
