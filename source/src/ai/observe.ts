// Observation encoding for AI controllers.
//
// Two forms, both built from the same SimState:
//  - vector: fixed-size Float32Array for neural networks. MAX_AIRCRAFT slots of
//    AIRCRAFT_FEATURES each, then GLOBAL_FEATURES. An aircraft keeps its slot for
//    its whole life (slots are reused after it leaves), so an action aimed at a
//    slot always means the same aircraft.
//  - state: compact JSON for rule-based or language-model controllers.
//
// Everything is normalised to roughly [-1, 1] or [0, 1].

import type { Aircraft, Airport, SimState } from '../engine/index.js';
import { findFix, performanceOf } from '../engine/index.js';

export const MAX_AIRCRAFT = 32;
export const MAX_RUNWAYS = 4;

export const AIRCRAFT_FEATURE_NAMES = [
  'present',
  'is_arrival',
  'status_waiting',
  'status_lineup',
  'status_rolling',
  'status_airborne',
  'mode_heading',
  'mode_direct',
  'mode_hold',
  'mode_approach',
  'mode_localizer',
  'x', // / boundary half-width
  'y', // / boundary half-height
  'heading_sin',
  'heading_cos',
  'altitude', // / 10,000 ft
  'target_altitude',
  'speed', // / 300 kt
  'target_speed',
  'target_heading_sin',
  'target_heading_cos',
  'in_conflict',
  'conflict_warning',
  'cat_light',
  'cat_medium',
  'cat_heavy',
  'exit_dx', // exit fix relative to the aircraft, / half-width (departures)
  'exit_dy',
  'exit_altitude', // / 10,000 ft
  ...Array.from({ length: MAX_RUNWAYS }, (_, i) => `runway_${i}`), // assigned / cleared runway, one-hot
  'distance', // from the airport, / 30 nm
  'landing_cleared', // cleared to land (0 with an approach clearance only)
  'status_rollout', // landed, decelerating on the runway
  'approach_speed', // the type's final approach speed, / 300 kt
] as const;

export const GLOBAL_FEATURE_NAMES = [
  'wind_from_sin',
  'wind_from_cos',
  'wind_speed', // / 20 kt
  ...Array.from({ length: MAX_RUNWAYS }, (_, i) => `runway_${i}_in_use`),
  ...Array.from({ length: MAX_RUNWAYS }, (_, i) => `runway_${i}_occupied`),
  'episode_progress', // 0..1
  'aircraft_count', // / MAX_AIRCRAFT
] as const;

export const AIRCRAFT_FEATURES = AIRCRAFT_FEATURE_NAMES.length;
export const GLOBAL_FEATURES = GLOBAL_FEATURE_NAMES.length;
export const OBS_SIZE = MAX_AIRCRAFT * AIRCRAFT_FEATURES + GLOBAL_FEATURES;

const DEG = Math.PI / 180;

/** Keeps aircraft id -> slot assignments stable across steps. One per environment. */
export class SlotMap {
  private bySlot: (number | null)[] = new Array(MAX_AIRCRAFT).fill(null);
  private byId = new Map<number, number>();

  reset(): void {
    this.bySlot.fill(null);
    this.byId.clear();
  }

  /** Update for the current aircraft list. Aircraft beyond MAX_AIRCRAFT get no slot. */
  sync(aircraft: readonly Aircraft[]): void {
    const alive = new Set(aircraft.map((a) => a.id));
    for (const [id, slot] of this.byId) {
      if (!alive.has(id)) {
        this.byId.delete(id);
        this.bySlot[slot] = null;
      }
    }
    for (const ac of aircraft) {
      if (this.byId.has(ac.id)) continue;
      const free = this.bySlot.indexOf(null);
      if (free < 0) break;
      this.bySlot[free] = ac.id;
      this.byId.set(ac.id, free);
    }
  }

  slotOf(id: number): number | undefined {
    return this.byId.get(id);
  }

  idAt(slot: number): number | null {
    return this.bySlot[slot] ?? null;
  }
}

export function encodeVector(state: SimState, airport: Airport, slots: SlotMap, progress: number): Float32Array {
  const out = new Float32Array(OBS_SIZE);
  const { halfWidth, halfHeight } = airport.boundary;
  const runwayIndex = new Map(airport.runways.slice(0, MAX_RUNWAYS).map((r, i) => [r.id, i]));

  for (const ac of state.aircraft) {
    const slot = slots.slotOf(ac.id);
    if (slot === undefined) continue;
    const o = slot * AIRCRAFT_FEATURES;
    let k = o;
    out[k++] = 1;
    out[k++] = ac.isArrival ? 1 : 0;
    out[k++] = ac.status === 'waiting' ? 1 : 0;
    out[k++] = ac.status === 'lineup' ? 1 : 0;
    out[k++] = ac.status === 'rolling' ? 1 : 0;
    out[k++] = ac.status === 'airborne' ? 1 : 0;
    out[k++] = ac.lateralMode === 'heading' ? 1 : 0;
    out[k++] = ac.lateralMode === 'direct' ? 1 : 0;
    out[k++] = ac.lateralMode === 'hold' ? 1 : 0;
    out[k++] = ac.lateralMode === 'approach' ? 1 : 0;
    out[k++] = ac.lateralMode === 'localizer' ? 1 : 0;
    out[k++] = ac.x / halfWidth;
    out[k++] = ac.y / halfHeight;
    out[k++] = Math.sin(ac.heading * DEG);
    out[k++] = Math.cos(ac.heading * DEG);
    out[k++] = ac.altitude / 10000;
    out[k++] = ac.targetAltitude / 10000;
    out[k++] = ac.speed / 300;
    out[k++] = ac.targetSpeed / 300;
    out[k++] = Math.sin(ac.targetHeading * DEG);
    out[k++] = Math.cos(ac.targetHeading * DEG);
    out[k++] = ac.inConflict ? 1 : 0;
    out[k++] = ac.conflictWarning ? 1 : 0;
    out[k++] = ac.category === 'light' ? 1 : 0;
    out[k++] = ac.category === 'medium' ? 1 : 0;
    out[k++] = ac.category === 'heavy' ? 1 : 0;
    const exit = ac.exitFix ? findFix(airport, ac.exitFix) : undefined;
    out[k++] = exit ? (exit.x - ac.x) / halfWidth : 0;
    out[k++] = exit ? (exit.y - ac.y) / halfHeight : 0;
    out[k++] = ac.exitAltitude / 10000;
    const ri = ac.runway !== null ? runwayIndex.get(ac.runway) : undefined;
    for (let r = 0; r < MAX_RUNWAYS; r++) out[k++] = ri === r ? 1 : 0;
    out[k++] = Math.hypot(ac.x, ac.y) / 30;
    out[k++] = ac.landingCleared ? 1 : 0;
    out[k++] = ac.status === 'rollout' ? 1 : 0;
    out[k++] = performanceOf(ac).approachSpeed / 300;
  }

  let g = MAX_AIRCRAFT * AIRCRAFT_FEATURES;
  out[g++] = Math.sin(state.wind.direction * DEG);
  out[g++] = Math.cos(state.wind.direction * DEG);
  out[g++] = state.wind.speed / 20;
  const occupied = new Set<string>();
  for (const ac of state.aircraft) {
    if ((ac.status === 'lineup' || ac.status === 'rolling' || ac.status === 'rollout') && ac.runway) occupied.add(ac.runway);
  }
  for (let r = 0; r < MAX_RUNWAYS; r++) {
    const rw = airport.runways[r];
    out[g + r] = rw && state.runwaysInUse.includes(rw.id) ? 1 : 0;
    out[g + MAX_RUNWAYS + r] = rw && occupied.has(rw.id) ? 1 : 0;
  }
  g += 2 * MAX_RUNWAYS;
  out[g++] = progress;
  out[g++] = state.aircraft.length / MAX_AIRCRAFT;
  return out;
}

/** Compact structured view for rule-based / language-model controllers. */
export interface AircraftView {
  slot: number | null;
  callsign: string;
  type: string;
  category: Aircraft['category'];
  arrival: boolean;
  status: Aircraft['status'];
  mode: Aircraft['lateralMode'];
  x: number;
  y: number;
  heading: number;
  altitude: number;
  speed: number;
  targetHeading: number;
  targetAltitude: number;
  targetSpeed: number;
  route: string[];
  hold: string | null;
  runway: string | null;
  landingCleared: boolean;
  exitFix: string | null;
  exitAltitude: number;
  inConflict: boolean;
  conflictWarning: boolean;
  /** The type's performance, so rule-based and language-model controllers need no table of their own. */
  perf: { climbRate: number; descentRate: number; minSpeed: number; maxSpeed: number; approachSpeed: number };
}

export interface StateView {
  tick: number;
  time: number;
  wind: SimState['wind'];
  runwaysInUse: string[];
  runwayBusyUntil: Record<string, number>;
  aircraft: AircraftView[];
  stats: SimState['stats'];
}

export function encodeState(state: SimState, slots: SlotMap): StateView {
  const r1 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    tick: state.tick,
    time: state.time,
    wind: { ...state.wind },
    runwaysInUse: [...state.runwaysInUse],
    runwayBusyUntil: { ...state.runwayBusyUntil },
    stats: { ...state.stats },
    aircraft: state.aircraft.map((ac) => ({
      slot: slots.slotOf(ac.id) ?? null,
      callsign: ac.callsign,
      type: ac.type,
      category: ac.category,
      arrival: ac.isArrival,
      status: ac.status,
      mode: ac.lateralMode,
      x: r1(ac.x),
      y: r1(ac.y),
      heading: r1(ac.heading),
      altitude: Math.round(ac.altitude),
      speed: r1(ac.speed),
      targetHeading: r1(ac.targetHeading),
      targetAltitude: ac.targetAltitude,
      targetSpeed: ac.targetSpeed,
      route: [...ac.route],
      hold: ac.hold ? (ac.hold.fix ?? 'here') : null,
      runway: ac.runway,
      landingCleared: ac.landingCleared,
      exitFix: ac.exitFix,
      exitAltitude: ac.exitAltitude,
      inConflict: ac.inConflict,
      conflictWarning: ac.conflictWarning,
      perf: perfView(ac),
    })),
  };
}

function perfView(ac: Aircraft): AircraftView['perf'] {
  const p = performanceOf(ac);
  return { climbRate: p.climbRate, descentRate: p.descentRate, minSpeed: p.minSpeed, maxSpeed: p.maxSpeed, approachSpeed: p.approachSpeed };
}
