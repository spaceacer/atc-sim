// Helpers for building airport data from real coordinates.
// The engine works on a flat nm plane around the airport reference point;
// over a ~40 nm radius the equirectangular projection error is negligible.

import type { Fix, FixKind, RunwayEnd } from '../engine/types.js';
import { bearing } from '../engine/index.js';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Project a lat/lon to nm east (x) and north (y) of the reference point. */
export function project(ref: LatLon, p: LatLon): { x: number; y: number } {
  const x = (p.lon - ref.lon) * 60 * Math.cos((ref.lat * Math.PI) / 180);
  const y = (p.lat - ref.lat) * 60;
  return { x: round3(x), y: round3(y) };
}

/**
 * Both ends of one runway from the coordinates of its two thresholds.
 * End A's landing direction points from A toward B.
 */
export function runwayPair(ref: LatLon, idA: string, a: LatLon, idB: string, b: LatLon): [RunwayEnd, RunwayEnd] {
  const pa = project(ref, a);
  const pb = project(ref, b);
  const hdgA = Math.round(bearing(pa.x, pa.y, pb.x, pb.y) * 10) / 10;
  const hdgB = Math.round(bearing(pb.x, pb.y, pa.x, pa.y) * 10) / 10;
  return [
    { id: idA, heading: hdgA, thresholdX: pa.x, thresholdY: pa.y, oppositeId: idB },
    { id: idB, heading: hdgB, thresholdX: pb.x, thresholdY: pb.y, oppositeId: idA },
  ];
}

export function fixAt(ref: LatLon, name: string, p: LatLon, kind: FixKind = 'fix'): Fix {
  return { name, kind, ...project(ref, p) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
