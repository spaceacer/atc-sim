// Aircraft performance per type.
//
// Each type records the figures we could source (EUROCONTROL Aircraft
// Performance Database as mirrored by SKYbrary, Boeing's published approach
// speeds, manufacturer fact sheets) or, where nothing could be read, an
// estimate marked as such in `sources`. The simulation's model values are
// derived from those figures with the formulas in `derive()`, so every number
// can be traced. See README "Aircraft performance" for the table and sources.

import type { WeightCategory } from '../types.js';

export interface Performance {
  turnRate: number; // deg/s (standard rate = 3)
  climbRate: number; // ft/min
  descentRate: number; // ft/min
  accel: number; // kt/s, airborne
  decel: number; // kt/s, airborne
  minSpeed: number; // lowest speed ATC may assign
  maxSpeed: number; // highest speed ATC may assign
  approachSpeed: number; // final approach speed (Vapp), flown automatically on final
  touchdownSpeed: number; // kt at the threshold
  maxAltitude: number; // ft
  takeoffAccel: number; // kt/s on the takeoff roll
  rotateSpeed: number; // kt, lift-off
  rolloutDecel: number; // kt/s on the landing rollout, down to 0
}

export type EngineKind = 'jet' | 'turboprop';

/** Figures as sourced (or estimated) for one type. */
export interface TypeData {
  type: string; // ICAO type designator shown on strips
  name: string;
  category: WeightCategory; // ICAO wake turbulence category
  engines: EngineKind;
  vapp: number; // kt IAS, final approach speed
  v2: number; // kt IAS, take-off safety speed
  takeoffDistance: number; // m, to 35 ft
  landingDistance: number; // m, from 50 ft to a stop
  climbRate: number; // ft/min, initial climb
  descentRate: number; // ft/min, terminal area
  maxSpeed: number; // kt, highest speed ATC may assign here
  maxAltitude: number; // ft
  /** Which figures are sourced and which are estimates. */
  sources: string;
}

const E = 'EUROCONTROL APD (via SKYbrary)';

export const TYPE_DATA: readonly TypeData[] = [
  { type: 'AT76', name: 'ATR 72-600', category: 'medium', engines: 'turboprop', vapp: 113, v2: 113, takeoffDistance: 1279, landingDistance: 915, climbRate: 1355, descentRate: 1500, maxSpeed: 240, maxAltitude: 25000,
    sources: 'Vapp, field lengths, climb: ATR 72-600 factsheet. V2: ' + E + ' for the ATR 72-210 (estimate for the -600). Descent: estimate.' },
  { type: 'DH8D', name: 'De Havilland Dash 8-400', category: 'medium', engines: 'turboprop', vapp: 120, v2: 125, takeoffDistance: 1220, landingDistance: 1293, climbRate: 2000, descentRate: 2000, maxSpeed: 270, maxAltitude: 27000,
    sources: 'Field lengths: ' + E + '. Vapp, V2, climb, descent: estimates (not published in sources read).' },
  { type: 'CRJ9', name: 'Bombardier CRJ900', category: 'medium', engines: 'jet', vapp: 140, v2: 145, takeoffDistance: 1778, landingDistance: 1596, climbRate: 2500, descentRate: 2000, maxSpeed: 290, maxAltitude: 41000,
    sources: 'Field lengths: Bombardier figures via flyradius.com. Vapp, V2, climb, descent: estimates.' },
  { type: 'E75L', name: 'Embraer 175', category: 'medium', engines: 'jet', vapp: 128, v2: 140, takeoffDistance: 1724, landingDistance: 1259, climbRate: 3000, descentRate: 2000, maxSpeed: 290, maxAltitude: 41000,
    sources: 'Field lengths: Embraer E175 specification. Vapp, V2, climb: estimates from the E170 in ' + E + ' (124 kt, 138 kt, 3,400 ft/min). Descent: estimate.' },
  { type: 'A320', name: 'Airbus A320', category: 'medium', engines: 'jet', vapp: 137, v2: 145, takeoffDistance: 2100, landingDistance: 1440, climbRate: 2500, descentRate: 2000, maxSpeed: 300, maxAltitude: 39000,
    sources: 'Vapp, V2, landing distance, climb: ' + E + '. Take-off distance, descent: estimates.' },
  { type: 'A20N', name: 'Airbus A320neo', category: 'medium', engines: 'jet', vapp: 137, v2: 145, takeoffDistance: 1950, landingDistance: 1440, climbRate: 2500, descentRate: 2000, maxSpeed: 300, maxAltitude: 39000,
    sources: 'Vapp, V2, landing distance, climb: ' + E + '. Take-off distance: aerocorner.com. Descent: estimate.' },
  { type: 'A321', name: 'Airbus A321', category: 'medium', engines: 'jet', vapp: 134, v2: 145, takeoffDistance: 2210, landingDistance: 1600, climbRate: 2500, descentRate: 2500, maxSpeed: 300, maxAltitude: 39000,
    sources: E + ' (all figures).' },
  { type: 'A21N', name: 'Airbus A321neo', category: 'medium', engines: 'jet', vapp: 134, v2: 145, takeoffDistance: 2210, landingDistance: 1600, climbRate: 2500, descentRate: 2500, maxSpeed: 300, maxAltitude: 39000,
    sources: E + ' (all figures).' },
  { type: 'B738', name: 'Boeing 737-800', category: 'medium', engines: 'jet', vapp: 142, v2: 145, takeoffDistance: 2300, landingDistance: 1600, climbRate: 3000, descentRate: 2500, maxSpeed: 300, maxAltitude: 41000,
    sources: 'Vapp: Boeing (FAA reference code and approach speeds). Others: ' + E + '; descent estimate.' },
  { type: 'B739', name: 'Boeing 737-900ER', category: 'medium', engines: 'jet', vapp: 144, v2: 149, takeoffDistance: 2300, landingDistance: 1700, climbRate: 3000, descentRate: 2500, maxSpeed: 300, maxAltitude: 41000,
    sources: 'Vapp: Boeing. Others: ' + E + '; descent estimate.' },
  { type: 'A333', name: 'Airbus A330-300', category: 'heavy', engines: 'jet', vapp: 130, v2: 145, takeoffDistance: 2300, landingDistance: 1700, climbRate: 2000, descentRate: 2000, maxSpeed: 310, maxAltitude: 41000,
    sources: E + '; descent estimate.' },
  { type: 'A359', name: 'Airbus A350-900', category: 'heavy', engines: 'jet', vapp: 145, v2: 150, takeoffDistance: 2600, landingDistance: 1600, climbRate: 3000, descentRate: 1500, maxSpeed: 310, maxAltitude: 43000,
    sources: 'Vapp: FAA AC 150/5300-13A (via Wikipedia). V2, climb, descent: ' + E + '. Field lengths: estimates (the APD entry looked inconsistent).' },
  { type: 'B788', name: 'Boeing 787-8', category: 'heavy', engines: 'jet', vapp: 145, v2: 165, takeoffDistance: 3100, landingDistance: 1520, climbRate: 2700, descentRate: 1500, maxSpeed: 310, maxAltitude: 43000,
    sources: 'Vapp: Boeing. Others: ' + E + '; descent estimate.' },
  { type: 'B789', name: 'Boeing 787-9', category: 'heavy', engines: 'jet', vapp: 153, v2: 165, takeoffDistance: 3100, landingDistance: 1600, climbRate: 2700, descentRate: 1500, maxSpeed: 310, maxAltitude: 43000,
    sources: 'Vapp: Boeing. Others: estimates from the 787-8.' },
  { type: 'B77W', name: 'Boeing 777-300ER', category: 'heavy', engines: 'jet', vapp: 150, v2: 168, takeoffDistance: 3000, landingDistance: 1800, climbRate: 3000, descentRate: 1500, maxSpeed: 310, maxAltitude: 43000,
    sources: 'Vapp: Boeing. Others: ' + E + '.' },
];

const KT = 1852 / 3600; // m/s per kt
/** Part of the landing distance flown in the air from 50 ft to touchdown, m. */
const AIR_DISTANCE_M = 300;
/** Operational braking stops in this multiple of the certified (maximum effort) ground roll. */
const OPERATIONAL_ROLLOUT_FACTOR = 1.4;
/** The ground roll is this share of the take-off distance to 35 ft. */
const GROUND_ROLL_SHARE = 0.85;

const round10 = (n: number) => Math.round(n / 10) * 10;

/** Model values from the sourced figures. */
export function derive(d: TypeData): Performance {
  const rotateSpeed = d.v2 - 5;
  const touchdownSpeed = d.vapp - 5; // Vapp carries about 5 kt of additive over Vref
  const groundRoll = d.takeoffDistance * GROUND_ROLL_SHARE;
  const rollout = (d.landingDistance - AIR_DISTANCE_M) * OPERATIONAL_ROLLOUT_FACTOR;
  const ms = (kt: number) => kt * KT;
  const toKtPerSec = (mps2: number) => mps2 / KT;
  const turboprop = d.engines === 'turboprop';
  const heavy = d.category === 'heavy';
  return {
    turnRate: 3,
    climbRate: d.climbRate,
    descentRate: d.descentRate,
    accel: turboprop ? 1.5 : heavy ? 1.0 : 1.2,
    decel: turboprop ? 1.5 : heavy ? 1.0 : 1.2,
    minSpeed: round10(d.vapp + 25),
    maxSpeed: d.maxSpeed,
    approachSpeed: d.vapp,
    touchdownSpeed,
    maxAltitude: d.maxAltitude,
    takeoffAccel: Math.round(toKtPerSec(ms(rotateSpeed) ** 2 / (2 * groundRoll)) * 100) / 100,
    rotateSpeed,
    rolloutDecel: Math.round(toKtPerSec(ms(touchdownSpeed) ** 2 / (2 * rollout)) * 100) / 100,
  };
}

const BY_TYPE = new Map(TYPE_DATA.map((d) => [d.type, derive(d)]));
const DATA_BY_TYPE = new Map(TYPE_DATA.map((d) => [d.type, d]));

/** A representative type per wake category, for aircraft created without a type (tests). */
export const CATEGORY_TYPE: Record<WeightCategory, string> = { light: 'AT76', medium: 'A320', heavy: 'B77W' };

/** Performance by category: the representative type's. Kept for callers that only know the category. */
export const PERFORMANCE: Record<WeightCategory, Performance> = {
  light: BY_TYPE.get(CATEGORY_TYPE.light)!,
  medium: BY_TYPE.get(CATEGORY_TYPE.medium)!,
  heavy: BY_TYPE.get(CATEGORY_TYPE.heavy)!,
};

/** Performance of an aircraft: by its type, else by its category. */
export function performanceOf(ac: { type: string; category: WeightCategory }): Performance {
  return BY_TYPE.get(ac.type) ?? PERFORMANCE[ac.category];
}

export function typeData(type: string): TypeData | undefined {
  return DATA_BY_TYPE.get(type);
}

/** Runway length a departure needs, m: its take-off distance (at maximum take-off weight, so conservative). */
export function takeoffRunNeeded(ac: { type: string; category: WeightCategory }): number {
  return (DATA_BY_TYPE.get(ac.type) ?? DATA_BY_TYPE.get(CATEGORY_TYPE[ac.category]))?.takeoffDistance ?? 2500;
}

export interface AircraftTypeInfo {
  type: string;
  category: WeightCategory;
}

/** Every type, for the spawner (an airport's fleet weights pick among them). */
export const AIRCRAFT_TYPES: readonly AircraftTypeInfo[] = TYPE_DATA.map((d) => ({ type: d.type, category: d.category }));
