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

/**
 * Two arrivals established on the same ILS are in a different environment from
 * traffic in the air: they are sequenced in trail, so the vertical minimum does
 * not apply (they are always within a glidepath's height of each other) and the
 * lateral minimum is reduced by this much (3 nm becomes 2.5 nm).
 */
export const FINAL_REDUCTION_NM = 0.5;

/** Minima that apply to this pair: reduced, lateral only, for two arrivals on the same final. */
export function pairMinima(a: Aircraft, b: Aircraft, minima: SeparationMinima): SeparationMinima {
  if (a.lateralMode === 'localizer' && b.lateralMode === 'localizer' && a.runway !== null && a.runway === b.runway) {
    return { lateralNm: Math.max(1, minima.lateralNm - FINAL_REDUCTION_NM), verticalFt: Infinity };
  }
  return minima;
}

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
      const m = pairMinima(a, b, minima);
      const lat = m.lateralNm;
      const vertical = Math.abs(a.altitude - b.altitude);
      if (vertical >= m.verticalFt) continue;
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
