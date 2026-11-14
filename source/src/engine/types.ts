// Core data contracts for the simulation engine.
//
// Everything here is plain, JSON-serialisable data. The engine never stores
// class instances, functions or DOM objects in state, so state can be hashed,
// snapshotted, replayed or sent to another process (e.g. Python) as-is.
//
// Units and conventions (used everywhere in the engine):
//   position  x, y   nautical miles on a flat local plane, airport reference point at (0, 0)
//                    +x = east, +y = north
//   heading          degrees true, 0 = north, clockwise, range (0, 360]
//   altitude         feet MSL
//   speed            knots (ground speed; wind does not push aircraft yet)
//   wind direction   degrees true the wind blows FROM
//   time             one tick = DT seconds of simulated time

export type WeightCategory = 'light' | 'medium' | 'heavy';

/** Lateral guidance mode: what the aircraft is steering toward. */
export type LateralMode =
  | 'heading' // fly targetHeading
  | 'direct' // fly direct to route[0], then the next fix; heading mode after the last
  | 'hold' // racetrack hold at a fix or a point (see HoldState)
  | 'approach' // cleared to land: hold heading until the extended centreline is reached
  | 'localizer'; // established on the extended centreline, tracking it to the runway

/**
 * Where the aircraft is in its life cycle.
 *  waiting   departure holding short of its runway (not on the scope, no separation)
 *  lineup    departure lined up on the runway, waiting for takeoff clearance
 *  rolling   takeoff roll
 *  airborne  flying
 *  landed / exited   finished; removed at the end of the tick
 */
export type HoldPhase = 'entry' | 'turnOut' | 'outbound' | 'turnIn' | 'inbound';

/** Racetrack hold: inbound leg ends at (x, y); turns in `turn` direction; 1-minute legs. */
export interface HoldState {
  fix: string | null; // null = holding over a point (where the hold was given)
  x: number;
  y: number;
  inbound: number; // inbound course, degrees
  turn: 'L' | 'R';
  phase: HoldPhase;
  timer: number; // ticks left on the outbound leg
}

/** rollout = landed and decelerating on the runway (still occupying it); landed = stopped, removed. */
export type FlightStatus = 'waiting' | 'lineup' | 'rolling' | 'airborne' | 'rollout' | 'landed' | 'exited';

export interface Aircraft {
  id: number;
  callsign: string;
  type: string; // ICAO aircraft type, display only
  category: WeightCategory;
  isArrival: boolean;
  status: FlightStatus;

  // Kinematic state
  x: number;
  y: number;
  altitude: number;
  heading: number;
  speed: number;

  // Targets set by ATC commands
  targetHeading: number;
  turnDirection: 'L' | 'R' | null; // forced turn direction, null = shortest
  targetAltitude: number;
  targetSpeed: number;
  expedite: boolean;
  /** Current vertical speed, ft/min (negative descending). Eases toward the target rate. */
  verticalSpeed: number;

  // Guidance
  lateralMode: LateralMode;
  route: string[]; // remaining fixes in 'direct' mode
  hold: HoldState | null; // set in 'hold' mode
  runway: string | null; // runway end cleared for the approach / to land on, or departure runway
  /** Cleared to land (L). False with an approach clearance only (I): it must be cleared by LANDING_CLEARANCE_NM. */
  landingCleared: boolean;
  lastCrossTrack: number | null; // nm, used to detect centreline crossing
  /** Lateral guidance is held (runway heading) until this altitude. 0 = no restriction. */
  turnAltitude: number;
  /** Departure lined up or rolling from a mid-runway intersection (null = full length). */
  fromIntersection: string | null;
  /** Seconds left in a timed runway phase: lining up, or vacating after a cancelled line-up or rejected takeoff. */
  groundSec: number;
  /** Cleared for takeoff: starts rolling as soon as it is lined up. */
  takeoffCleared: boolean;
  /** Rejecting the takeoff (braking) or vacating the runway; back to holding short when done. */
  aborting: boolean;

  // Departures
  exitFix: string | null;
  exitAltitude: number; // ft, minimum altitude when leaving through exitFix

  // Flags refreshed by the rules, for display, rules and observations
  inConflict: boolean; // separation lost now
  conflictWarning: boolean; // predicted to lose separation within the look-ahead

  spawnTick: number;
}

export interface RunwayEnd {
  id: string; // e.g. "27"
  heading: number; // landing / takeoff direction, degrees true
  thresholdX: number;
  thresholdY: number;
  oppositeId: string; // the other end of the same strip of concrete
  /** Has an ILS (default true). Without one, landings are visual approaches and no centreline is drawn. */
  ils?: boolean;
  /** Mid-runway departure points, with the runway length left ahead from each. */
  intersections?: RunwayIntersection[];
}

export interface RunwayIntersection {
  name: string; // the entry taxiway, e.g. "N4"
  remainingM: number; // take-off run available from here, m
  /** Name and length not confirmed from official data yet. */
  placeholder?: boolean;
}

export type FixKind = 'fix' | 'vor' | 'exit';

export interface Fix {
  name: string;
  x: number;
  y: number;
  kind: FixKind;
}

/** Rectangular airspace centred on the airport reference point. */
export interface Boundary {
  halfWidth: number; // nm east/west of the airport
  halfHeight: number; // nm north/south of the airport
}

export interface Airport {
  icao: string;
  name: string;
  city: string;
  elevation: number; // feet MSL
  boundary: Boundary;
  runways: RunwayEnd[];
  fixes: Fix[]; // includes exit fixes (kind 'exit') on the boundary
  displayRunwayWidth: number; // nm, drawn enlarged like ATC-SIM
  /** Airline ICAO codes the spawner draws callsigns from. */
  airlines: string[];
  /** Departure runway preference; the first one in use is assigned. */
  preferredRunways: string[];
  /** Relative weights of aircraft types (ICAO designators) in traffic; every type equally if absent. */
  fleet?: Record<string, number>;
}

export interface Wind {
  direction: number; // degrees true the wind blows from
  speed: number; // kt
}

export interface WeatherProfile {
  /** Starting wind; random if omitted. */
  initialWind?: Wind;
  /** If false the wind never changes (tests, set pieces). */
  variable: boolean;
  /** Typical strength of a random wind; 'moderate' if absent. */
  strength?: WindStrength;
}

export type WindStrength = 'calm' | 'light' | 'moderate' | 'strong';

export interface SpawnProfile {
  /** Seconds between spawns, chosen uniformly in [min, max]. */
  minIntervalSec: number;
  maxIntervalSec: number;
  /** Delay before the first spawn, seconds. */
  firstSec: number;
  /** Stop after this many (undefined = unlimited). */
  max?: number;
}

/** Multipliers on the airport's fleet weights (1 = as published). */
export interface FleetMix {
  turboprop?: number;
  heavy?: number;
}

export interface TrafficProfile {
  arrivals: SpawnProfile;
  departures: SpawnProfile;
  mix?: FleetMix;
}

/** Per-scenario rule switches (Settings > Rules). Nothing here acts on behalf of the controller. */
export interface ScenarioOptions {
  /** Separation minima: lateral nm (default 3) and vertical ft (default 1,000). */
  separation?: { lateralNm: number; verticalFt: number };
  /**
   * Require a separate landing clearance: I (intercept) no longer lands by itself;
   * L must follow by `landingClearanceNm` from the threshold or the aircraft goes around.
   */
  requireLandingClearance?: boolean;
  landingClearanceNm?: number;
  /** Conflict prediction look-ahead, seconds (default 60; 0 turns alerts off). */
  conflictLookaheadSec?: number;
}

export interface Scenario {
  seed: number;
  airport: Airport;
  traffic: TrafficProfile;
  weather: WeatherProfile;
  options?: ScenarioOptions;
}

// ---------------------------------------------------------------------------
// Commands: exactly what a human (or an AI agent) can issue.

export type Command =
  | { type: 'heading'; callsign: string; heading: number; turn?: 'L' | 'R' }
  | { type: 'altitude'; callsign: string; altitude: number; expedite?: boolean }
  | { type: 'speed'; callsign: string; speed: number }
  | { type: 'land'; callsign: string; runway: string }
  | { type: 'intercept'; callsign: string; runway: string }
  | { type: 'direct'; callsign: string; fixes: string[] }
  | { type: 'lineUp'; callsign: string; runway?: string; intersection?: string }
  | { type: 'takeoff'; callsign: string; runway?: string; intersection?: string }
  | { type: 'hold'; callsign: string; fix?: string; turn?: 'L' | 'R' }
  | { type: 'goAround'; callsign: string };

export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface LoggedCommand {
  tick: number;
  command: Command;
}

// ---------------------------------------------------------------------------
// Events: what happened during a tick. Drained by the caller.

export type SimEvent =
  | { type: 'spawned'; tick: number; callsign: string; isArrival: boolean; where: string }
  | { type: 'tookOff'; tick: number; callsign: string; runway: string }
  | { type: 'linedUp'; tick: number; callsign: string; runway: string }
  | { type: 'takeoffAborted'; tick: number; callsign: string; runway: string; rolling: boolean }
  | { type: 'vacated'; tick: number; callsign: string; runway: string }
  | { type: 'runwayReassigned'; tick: number; callsign: string; from: string; to: string }
  | { type: 'touchdown'; tick: number; callsign: string; runway: string }
  | { type: 'landed'; tick: number; callsign: string; runway: string }
  | { type: 'missedApproach'; tick: number; callsign: string; runway: string; reason: string }
  | { type: 'departed'; tick: number; callsign: string; fix: string }
  | { type: 'wrongExit'; tick: number; callsign: string; reason: string }
  | { type: 'leftAirspace'; tick: number; callsign: string }
  | { type: 'separationLoss'; tick: number; a: string; b: string; distance: number; verticalFt: number }
  | { type: 'runwayConflict'; tick: number; arrival: string; blocker: string; runway: string; distanceNm: number }
  | { type: 'commandAccepted'; tick: number; callsign: string; message: string }
  | { type: 'commandRejected'; tick: number; callsign: string; message: string }
  | { type: 'localizerCaptured'; tick: number; callsign: string; runway: string }
  | { type: 'runwaysChanged'; tick: number; inUse: string[] }
  | { type: 'conflictWarning'; tick: number; a: string; b: string; inSeconds: number };

export interface Stats {
  score: number;
  arrivalsSpawned: number;
  departuresSpawned: number;
  landed: number;
  departed: number;
  wrongExits: number;
  separationLosses: number;
  conflictWarnings: number; // predicted conflicts (no score effect)
  missedApproaches: number;
  leftAirspace: number;
  commandsIssued: number;
}

export interface SimState {
  tick: number;
  time: number; // seconds of simulated time
  /** All live aircraft, ground and airborne, in stable spawn order. */
  aircraft: Aircraft[];
  wind: Wind;
  /** Runway ends usable with the current wind (tailwind within limits). */
  runwaysInUse: string[];
  /** Unused since 0.6.0 (landing rollouts occupy runways as aircraft); kept empty for file and API compatibility. */
  runwayBusyUntil: Record<string, number>;
  stats: Stats;
}
