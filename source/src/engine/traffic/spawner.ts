// Seeded traffic generation.
//  Arrivals: anywhere on the airspace edge, 4,000-8,000 ft, heading roughly at the airport.
//  Departures: appear holding short of the preferred runway in use, with an
//  assigned exit fix and the minimum altitude to leave at.

import type { Aircraft, Airport, FleetMix, SpawnProfile } from '../types.js';
import { TYPE_DATA, performanceOf, type TypeData } from '../aircraft/performance.js';
import { bearing, distance, normHeading } from '../geometry.js';
import { nextFloat, nextInt, pick, type RngState } from '../rng.js';
import { findRunway } from '../airspace/airport.js';

const ARRIVAL_ALTITUDES = [4000, 5000, 6000, 7000, 8000] as const;
const EXIT_ALTITUDES = [9000, 10000, 11000, 12000] as const;
const ARRIVAL_SPEED = 250;
const DEPARTURE_SPEED = 250;
const DEPARTURE_INITIAL_ALTITUDE = 5000;
/** Departures fly runway heading until this height above the field, ft. */
export const DEPARTURE_TURN_HEIGHT = 500;
/** Keep spawns this far from existing traffic (unless 1,000 ft apart). */
const SPAWN_CLEARANCE_NM = 8;
/** Arrivals do not appear this close to a corner of the airspace, nm. */
const CORNER_INSET_NM = 4;
/** Arrivals point at the airport give or take this much, degrees. */
const HEADING_SPREAD = 20;
const SPAWN_ATTEMPTS = 12;
const MAX_WAITING_DEPARTURES = 4;
/** Retry delay when there is no room, seconds. */
const RETRY_SEC = 20;

export interface SpawnTimer {
  nextTick: number;
  spawned: number;
}

export interface SpawnerState {
  arrivals: SpawnTimer;
  departures: SpawnTimer;
  usedCallsigns: string[];
}

export function createSpawner(arr: SpawnProfile, dep: SpawnProfile, dt: number): SpawnerState {
  return {
    arrivals: { nextTick: Math.round(arr.firstSec / dt), spawned: 0 },
    departures: { nextTick: Math.round(dep.firstSec / dt), spawned: 0 },
    usedCallsigns: [],
  };
}

function due(timer: SpawnTimer, profile: SpawnProfile, tick: number): boolean {
  if (tick < timer.nextTick) return false;
  return profile.max === undefined || timer.spawned < profile.max;
}

function schedule(timer: SpawnTimer, profile: SpawnProfile, rng: RngState, tick: number, dt: number): void {
  const interval = profile.minIntervalSec + nextFloat(rng) * (profile.maxIntervalSec - profile.minIntervalSec);
  timer.nextTick = tick + Math.max(1, Math.round(interval / dt));
}

/** A new arrival on the airspace edge, if one is due and there is room. */
export function trySpawnArrival(
  spawner: SpawnerState,
  rng: RngState,
  profile: SpawnProfile,
  airport: Airport,
  traffic: readonly Aircraft[],
  tick: number,
  dt: number,
  nextId: number,
  mix?: FleetMix,
): { aircraft: Aircraft; where: string } | null {
  const timer = spawner.arrivals;
  if (!due(timer, profile, tick)) return null;

  const { halfWidth: hw, halfHeight: hh } = airport.boundary;
  let chosen: { x: number; y: number; altitude: number } | null = null;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS && !chosen; attempt++) {
    // Pick a point on the perimeter, uniformly by length, away from the corners.
    const w = 2 * (hw - CORNER_INSET_NM);
    const h = 2 * (hh - CORNER_INSET_NM);
    let t = nextFloat(rng) * 2 * (w + h);
    let x: number;
    let y: number;
    if (t < w) {
      x = -hw + CORNER_INSET_NM + t;
      y = hh; // north edge
    } else if ((t -= w) < h) {
      x = hw; // east edge
      y = hh - CORNER_INSET_NM - t;
    } else if ((t -= h) < w) {
      x = hw - CORNER_INSET_NM - t;
      y = -hh; // south edge
    } else {
      t -= w;
      x = -hw; // west edge
      y = -hh + CORNER_INSET_NM + t;
    }
    const altitude = pick(rng, ARRIVAL_ALTITUDES);
    if (isClear(x, y, altitude, traffic)) chosen = { x, y, altitude };
  }
  if (!chosen) {
    timer.nextTick = tick + Math.round(RETRY_SEC / dt);
    return null;
  }

  const typeInfo = pickType(rng, airport, mix);
  const callsign = newCallsign(rng, airport, spawner.usedCallsigns);
  const spread = (nextFloat(rng) * 2 - 1) * HEADING_SPREAD;
  const heading = Math.round(normHeading(bearing(chosen.x, chosen.y, 0, 0) + spread)) || 360;
  timer.spawned++;
  schedule(timer, profile, rng, tick, dt);

  const aircraft = baseAircraft(nextId, callsign, typeInfo.type, typeInfo.category, tick);
  Object.assign(aircraft, {
    isArrival: true,
    status: 'airborne',
    x: chosen.x,
    y: chosen.y,
    altitude: chosen.altitude,
    targetAltitude: chosen.altitude,
    heading,
    targetHeading: heading,
    speed: Math.min(ARRIVAL_SPEED, performanceOf(aircraft).maxSpeed),
    targetSpeed: Math.min(ARRIVAL_SPEED, performanceOf(aircraft).maxSpeed),
  } satisfies Partial<Aircraft>);
  return { aircraft, where: compassName(chosen.x, chosen.y) };
}

/** A new departure holding short of its runway, if one is due and the queue has room. */
export function trySpawnDeparture(
  spawner: SpawnerState,
  rng: RngState,
  profile: SpawnProfile,
  airport: Airport,
  traffic: readonly Aircraft[],
  runwaysInUse: readonly string[],
  tick: number,
  dt: number,
  nextId: number,
  mix?: FleetMix,
): { aircraft: Aircraft; where: string } | null {
  const timer = spawner.departures;
  if (!due(timer, profile, tick)) return null;

  const exits = airport.fixes.filter((f) => f.kind === 'exit');
  const runwayId = airport.preferredRunways.find((r) => runwaysInUse.includes(r)) ?? runwaysInUse[0];
  const runway = runwayId ? findRunway(airport, runwayId) : undefined;
  const waiting = traffic.filter((a) => a.status === 'waiting' || a.status === 'lineup').length;
  if (!runway || exits.length === 0 || waiting >= MAX_WAITING_DEPARTURES) {
    timer.nextTick = tick + Math.round(RETRY_SEC / dt);
    return null;
  }

  const typeInfo = pickType(rng, airport, mix);
  const callsign = newCallsign(rng, airport, spawner.usedCallsigns);
  const exit = pick(rng, exits);
  const exitAltitude = pick(rng, EXIT_ALTITUDES);
  timer.spawned++;
  schedule(timer, profile, rng, tick, dt);

  const aircraft = baseAircraft(nextId, callsign, typeInfo.type, typeInfo.category, tick);
  Object.assign(aircraft, {
    isArrival: false,
    status: 'waiting',
    x: runway.thresholdX,
    y: runway.thresholdY,
    altitude: airport.elevation,
    targetAltitude: Math.max(DEPARTURE_INITIAL_ALTITUDE, roundUp(airport.elevation + 2000)),
    heading: runway.heading,
    targetHeading: runway.heading,
    speed: 0,
    targetSpeed: Math.min(DEPARTURE_SPEED, performanceOf(aircraft).maxSpeed),
    runway: runway.id,
    exitFix: exit.name,
    exitAltitude,
  } satisfies Partial<Aircraft>);
  return { aircraft, where: runway.id };
}

function baseAircraft(
  id: number,
  callsign: string,
  type: string,
  category: Aircraft['category'],
  tick: number,
): Aircraft {
  return {
    id,
    callsign,
    type,
    category,
    isArrival: true,
    status: 'airborne',
    x: 0,
    y: 0,
    altitude: 0,
    heading: 360,
    speed: 0,
    targetHeading: 360,
    turnDirection: null,
    targetAltitude: 0,
    targetSpeed: 0,
    expedite: false,
    verticalSpeed: 0,
    lateralMode: 'heading',
    route: [],
    runway: null,
    lastCrossTrack: null,
    landingCleared: false,
    fromIntersection: null,
    turnAltitude: 0,
    hold: null,
    exitFix: null,
    exitAltitude: 0,
    inConflict: false,
    conflictWarning: false,
    spawnTick: tick,
  };
}

/**
 * Pick an aircraft type by the airport's fleet weights (every type equally if it
 * has none), scaled by the scenario's turboprop and heavy shares.
 */
export function pickType(rng: RngState, airport: Airport, mix?: FleetMix): TypeData {
  const weights = TYPE_DATA.map((d) => {
    let w = airport.fleet ? (airport.fleet[d.type] ?? 0) : 1;
    if (d.engines === 'turboprop') w *= mix?.turboprop ?? 1;
    if (d.category === 'heavy') w *= mix?.heavy ?? 1;
    return Math.max(0, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(rng, TYPE_DATA);
  let r = nextFloat(rng) * total;
  for (let i = 0; i < TYPE_DATA.length; i++) {
    r -= weights[i];
    if (r < 0) return TYPE_DATA[i];
  }
  return TYPE_DATA[TYPE_DATA.length - 1];
}

function roundUp(alt: number): number {
  return Math.ceil(alt / 1000) * 1000;
}

function isClear(x: number, y: number, altitude: number, traffic: readonly Aircraft[]): boolean {
  for (const ac of traffic) {
    if (ac.status !== 'airborne') continue;
    if (distance(x, y, ac.x, ac.y) < SPAWN_CLEARANCE_NM && Math.abs(ac.altitude - altitude) < 1000) return false;
  }
  return true;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

function compassName(x: number, y: number): string {
  const b = bearing(0, 0, x, y);
  return COMPASS[Math.round(b / 45) % 8];
}

function newCallsign(rng: RngState, airport: Airport, used: string[]): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const cs = pick(rng, airport.airlines) + String(nextInt(rng, 10, 999));
    if (!used.includes(cs)) {
      used.push(cs);
      return cs;
    }
  }
  const cs = 'XXX' + String(used.length + 1000);
  used.push(cs);
  return cs;
}
