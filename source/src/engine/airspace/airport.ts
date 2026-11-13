// Airport geometry helpers: runway lookup, strips, intersections, wind limits.

import type { Airport, Boundary, Fix, RunwayEnd, Wind } from '../types.js';
import { headingDiff } from '../geometry.js';

const DEG = Math.PI / 180;

/** A runway in use closes when its tailwind exceeds this, kt. */
export const MAX_TAILWIND_KT = 5;
/** A closed runway reopens only when its tailwind is at most this (hysteresis, so gusts do not flip runways), kt. */
export const REOPEN_TAILWIND_KT = 3;

export function findRunway(airport: Airport, id: string): RunwayEnd | undefined {
  const want = id.toUpperCase();
  return airport.runways.find((r) => r.id === want);
}

export function findFix(airport: Airport, name: string): Fix | undefined {
  const want = name.toUpperCase();
  return airport.fixes.find((f) => f.name === want);
}

/** Id of the physical strip a runway end belongs to, e.g. "09/27". */
export function stripId(end: RunwayEnd): string {
  return end.id < end.oppositeId ? `${end.id}/${end.oppositeId}` : `${end.oppositeId}/${end.id}`;
}

/** Strip ids of every strip that shares concrete with this one (itself, and any it crosses). */
export function blockingStrips(airport: Airport, end: RunwayEnd): string[] {
  const out = [stripId(end)];
  const a = segment(airport, end);
  for (const other of airport.runways) {
    const id = stripId(other);
    if (out.includes(id)) continue;
    if (segmentsIntersect(a, segment(airport, other))) out.push(id);
  }
  return out;
}

/** Tailwind component on a runway end, kt (negative = headwind). */
export function tailwind(end: RunwayEnd, wind: Wind): number {
  return -wind.speed * Math.cos(headingDiff(end.heading, wind.direction) * DEG);
}

/**
 * Runway ends usable with this wind, in airport order. With `previous` (the
 * runways in use until now), a runway stays open up to MAX_TAILWIND_KT but a
 * closed one reopens only at REOPEN_TAILWIND_KT or less.
 */
export function runwaysInUse(airport: Airport, wind: Wind, previous?: readonly string[]): string[] {
  return airport.runways
    .filter((r) => {
      const tw = tailwind(r, wind);
      const wasOpen = previous === undefined || previous.includes(r.id);
      return tw <= (wasOpen ? MAX_TAILWIND_KT : REOPEN_TAILWIND_KT);
    })
    .map((r) => r.id);
}

export function insideBoundary(b: Boundary, x: number, y: number, margin = 0): boolean {
  return Math.abs(x) <= b.halfWidth + margin && Math.abs(y) <= b.halfHeight + margin;
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function segment(airport: Airport, end: RunwayEnd): Seg {
  const opp = findRunway(airport, end.oppositeId) ?? end;
  return { x1: end.thresholdX, y1: end.thresholdY, x2: opp.thresholdX, y2: opp.thresholdY };
}

function segmentsIntersect(a: Seg, b: Seg): boolean {
  const d = (a.x2 - a.x1) * (b.y2 - b.y1) - (a.y2 - a.y1) * (b.x2 - b.x1);
  if (d === 0) return false;
  const t = ((b.x1 - a.x1) * (b.y2 - b.y1) - (b.y1 - a.y1) * (b.x2 - b.x1)) / d;
  const u = ((b.x1 - a.x1) * (a.y2 - a.y1) - (b.y1 - a.y1) * (a.x2 - a.x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
