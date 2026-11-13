// Wind: a slow seeded random walk. It only decides which runways are in use;
// it does not push aircraft around yet (that is a later milestone).
// Uses its own PRNG stream, so changing the weather model never changes traffic.

import type { WeatherProfile, Wind, WindStrength } from './types.js';
import { nextFloat, type RngState } from './rng.js';
import { normHeading } from './geometry.js';

/** How often the wind changes, seconds of sim time. */
export const WIND_UPDATE_SEC = 60;
const MAX_DIRECTION_STEP = 8; // degrees per update
const MAX_SPEED_STEP = 1.5; // kt per update
const MIN_SPEED = 0;

/** Starting speed range and cap per wind strength, kt. 'moderate' is the pre-0.6.0 behaviour. */
export const WIND_STRENGTHS: Record<WindStrength, { min: number; max: number; cap: number }> = {
  calm: { min: 0, max: 3, cap: 6 },
  light: { min: 3, max: 9, cap: 14 },
  moderate: { min: 4, max: 16, cap: 22 },
  strong: { min: 14, max: 24, cap: 32 },
};

export function initialWind(profile: WeatherProfile, rng: RngState): Wind {
  if (profile.initialWind) return { ...profile.initialWind };
  const s = WIND_STRENGTHS[profile.strength ?? 'moderate'];
  return {
    direction: Math.round(normHeading(nextFloat(rng) * 360)),
    speed: Math.round(s.min + nextFloat(rng) * (s.max - s.min)),
  };
}

/** Advance the wind by one update step. Mutates `wind`. */
export function updateWind(wind: Wind, rng: RngState, strength: WindStrength = 'moderate'): void {
  const dDir = (nextFloat(rng) * 2 - 1) * MAX_DIRECTION_STEP;
  const dSpd = (nextFloat(rng) * 2 - 1) * MAX_SPEED_STEP;
  wind.direction = Math.round(normHeading(wind.direction + dDir));
  wind.speed = Math.round(Math.min(WIND_STRENGTHS[strength].cap, Math.max(MIN_SPEED, wind.speed + dSpd)) * 10) / 10;
}
