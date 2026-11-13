// Numeric action space for reinforcement learning: each action is a triple
// [slot, type, param]. It decodes to exactly the same Command a human would
// issue by typing, so an agent has no powers a player lacks.
//
//   slot   aircraft slot from the observation (0..MAX_AIRCRAFT-1)
//   type   index into ACTION_TYPES
//   param  0..PARAM_SIZE-1, meaning depends on the type (see ACTION_TYPES)
//
// Several actions may be sent in one step (e.g. heading + altitude for one
// aircraft, or one per aircraft). Noops and actions that do not apply are skipped.

import type { Airport, Command, SimState } from '../engine/index.js';
import { MAX_RUNWAYS, type SlotMap } from './observe.js';

export const PARAM_SIZE = 36;
/** Intersections per runway end addressable by the numeric action. */
export const MAX_INTERSECTIONS = 4;

export interface ActionType {
  name: string;
  params: number; // how many param values are meaningful
  describe: string;
}

export const ACTION_TYPES: readonly ActionType[] = [
  { name: 'noop', params: 1, describe: 'do nothing' },
  { name: 'heading', params: 36, describe: 'heading = (param + 1) * 10, i.e. 010..360' },
  { name: 'altitude', params: 14, describe: 'altitude = (param + 2) * 1000 ft, i.e. 2,000..15,000' },
  { name: 'speed', params: 10, describe: 'speed = 160 + 10 * param kt, i.e. 160..250' },
  { name: 'land', params: MAX_RUNWAYS, describe: 'cleared to land on airport.runways[param] (adds landing clearance to an approach, or covers both)' },
  { name: 'direct_exit', params: 1, describe: 'direct to the aircraft’s own exit fix' },
  { name: 'direct_fix', params: PARAM_SIZE, describe: 'direct to airport.fixes[param]' },
  { name: 'line_up', params: MAX_RUNWAYS, describe: 'line up and wait on airport.runways[param]' },
  { name: 'takeoff', params: MAX_RUNWAYS, describe: 'cleared for takeoff from airport.runways[param]' },
  { name: 'hold', params: 2, describe: 'hold at present position, param 0 = right turns, 1 = left' },
  { name: 'go_around', params: 1, describe: 'go around / cancel the approach clearance' },
  { name: 'intercept', params: MAX_RUNWAYS, describe: 'cleared to intercept (approach only, land later) airport.runways[param]' },
  {
    name: 'takeoff_intersection',
    params: MAX_RUNWAYS * MAX_INTERSECTIONS,
    describe: `cleared for takeoff from an intersection: runway airport.runways[param / ${MAX_INTERSECTIONS}], its intersections[param % ${MAX_INTERSECTIONS}]`,
  },
];

export type ActionTriple = [number, number, number];

/** Decode one triple. Returns null for noop or anything that does not name a live aircraft or valid param. */
export function decodeAction(
  action: readonly number[],
  state: SimState,
  airport: Airport,
  slots: SlotMap,
): Command | null {
  const [slot, type, param] = action.map((n) => Math.trunc(Number(n)));
  if (!Number.isFinite(slot) || !Number.isFinite(type) || !Number.isFinite(param)) return null;
  const name = ACTION_TYPES[type]?.name;
  if (!name || name === 'noop') return null;
  const id = slots.idAt(slot);
  const ac = id === null ? undefined : state.aircraft.find((a) => a.id === id);
  if (!ac) return null;
  const callsign = ac.callsign;
  const runway = airport.runways[param]?.id;

  switch (name) {
    case 'heading':
      return param >= 0 && param < 36 ? { type: 'heading', callsign, heading: (param + 1) * 10 } : null;
    case 'altitude':
      return param >= 0 && param < 14 ? { type: 'altitude', callsign, altitude: (param + 2) * 1000 } : null;
    case 'speed':
      return param >= 0 && param < 10 ? { type: 'speed', callsign, speed: 160 + 10 * param } : null;
    case 'land':
      return runway ? { type: 'land', callsign, runway } : null;
    case 'direct_exit':
      return ac.exitFix ? { type: 'direct', callsign, fixes: [ac.exitFix] } : null;
    case 'direct_fix': {
      const fix = airport.fixes[param];
      return fix ? { type: 'direct', callsign, fixes: [fix.name] } : null;
    }
    case 'line_up':
      return runway ? { type: 'lineUp', callsign, runway } : null;
    case 'takeoff':
      return runway ? { type: 'takeoff', callsign, runway } : null;
    case 'hold':
      return { type: 'hold', callsign, turn: param === 1 ? 'L' : 'R' };
    case 'go_around':
      return { type: 'goAround', callsign };
    case 'intercept':
      return runway ? { type: 'intercept', callsign, runway } : null;
    case 'takeoff_intersection': {
      const end = airport.runways[Math.floor(param / MAX_INTERSECTIONS)];
      const int = end?.intersections?.[param % MAX_INTERSECTIONS];
      return end && int ? { type: 'takeoff', callsign, runway: end.id, intersection: int.name } : null;
    }
    default:
      return null;
  }
}
