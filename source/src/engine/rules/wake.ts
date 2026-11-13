// Wake turbulence spacing between departures (ICAO Doc 4444 5.8.3): a light
// or medium aircraft taking off behind a heavy, or a light behind a medium,
// waits 2 minutes; 3 minutes when it departs from an intersection part-way
// down the runway (it lifts off where the leader's wake is). Shared by the
// radar and ground engines.

import type { WeightCategory } from '../types.js';

export const WAKE_DEPARTURE_SEC = 120;
export const WAKE_INTERSECTION_EXTRA_SEC = 60;

const RANK: Record<WeightCategory, number> = { light: 0, medium: 1, heavy: 2 };

/** Seconds a departure must wait after the leader's takeoff. */
export function departureWakeSec(leader: WeightCategory, follower: WeightCategory, fromIntersection: boolean): number {
  if (RANK[follower] >= RANK[leader]) return 0;
  return WAKE_DEPARTURE_SEC + (fromIntersection ? WAKE_INTERSECTION_EXTRA_SEC : 0);
}

export function wakeRank(c: WeightCategory): number {
  return RANK[c];
}
