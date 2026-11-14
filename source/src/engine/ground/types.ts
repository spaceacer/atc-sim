// Data contracts for the ground controller mode. Distances in metres, +x east,
// +y north, origin at the runway midpoint; speeds in knots; headings true.

import type { WeightCategory, Wind } from '../types.js';

export type EdgeKind = 'runway' | 'taxiway' | 'connector' | 'link' | 'taxilane' | 'stand';

export interface GNode {
  id: string;
  x: number;
  y: number;
  /** Runway holding position: stop here unless cleared onto or across the runway. */
  holdShort?: boolean;
  /** A node on the runway itself. */
  onRunway?: boolean;
  /** Airports with several runways: the runways this node lies on, and the runway it is a holding position for. */
  rwys?: string[];
  holdFor?: string;
  /** Where two runways cross: never a way off the runway, never a line-up point. */
  crossing?: boolean;
}

export interface GEdge {
  a: string;
  b: string;
  /** Taxiway / connector / stand name shown on the map and used in VIA. */
  name: string;
  kind: EdgeKind;
  /** Runway pavement (kind 'runway'): which runway. Not in use, it is a taxiway. */
  rwy?: string;
}

export interface Stand {
  id: string; // also the id of its node
  /** Taxilane node the aircraft is pushed back onto. */
  pushNode: string;
  /** Nose-in heading when parked. */
  heading: number;
  cargo: boolean;
}

export interface GroundRunwayEnd {
  id: string; // e.g. "27"
  heading: number; // landing/takeoff direction
  thresholdX: number;
  thresholdY: number;
  /** Departure holding point (a holdShort node) and the runway node it lines up from. */
  holdingPoint: string;
  lineupNode: string;
  oppositeId: string;
  /** Several runways: the physical runway ("09/27"). */
  name?: string;
  /** Far end of the usable take-off run (default: the opposite threshold). */
  endX?: number;
  endY?: number;
  /** Share of the type's take-off distance it needs here (reduced take-off weight on a short runway). Default 1. */
  takeoffFactor?: number;
}

/** A runway drawn from survey data: pavement, shoulders and markings in runway-local metres. */
export interface RunwayDrawing {
  name: string; // "09/27"
  /** Where it starts (x, y in ground metres), its unit direction and its length. */
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  length: number;
  width: number;
  shoulder: number;
  /** Marking polygons: flat s (along), t (across, left positive) in metres. */
  polys: number[][];
}

export interface GroundAirport {
  icao: string;
  name: string;
  elevation: number;
  /** Half extents of the drawn map, m. */
  halfWidth: number;
  halfHeight: number;
  /** Centre of the drawn map (default: the origin). */
  centerX?: number;
  centerY?: number;
  runwayWidth: number; // m, drawn
  nodes: GNode[];
  edges: GEdge[];
  stands: Stand[];
  runways: GroundRunwayEnd[];
  airlines: string[];
  cargoAirlines: string[];
  fleet?: Record<string, number>;
  cargoFleet?: Record<string, number>;
  /** Types that use particular stands (instead of the airport fleet). */
  standFleets?: Record<string, Record<string, number>>;
  /** Detailed runway drawing (pavement, shoulders, markings), per physical runway. */
  runwayMarks?: RunwayDrawing[];
  /** Building outlines to draw (closed polygons, flat x, y in metres). */
  buildings?: { name?: string; pts: number[] }[];
}

export type GroundStatus =
  | 'parked' // at a stand. Departures: not ready yet. Arrivals: arrived, about to leave the map
  | 'ready' // departure requesting pushback
  | 'pushback'
  | 'starting' // engines starting after pushback
  | 'taxi' // on the taxi graph (moving or stopped)
  | 'handoff' // departure at the holding point, the tower's now
  | 'lineup'
  | 'takeoff'
  | 'final' // arrival on final approach
  | 'landing'; // arrival rolling out on the runway

export interface GroundAircraft {
  id: number;
  callsign: string;
  type: string;
  category: WeightCategory;
  isArrival: boolean;
  cargo: boolean;
  status: GroundStatus;

  x: number;
  y: number;
  heading: number;
  speed: number; // kt

  /** Graph position: last node passed, the node being taxied to, and metres from `node`. */
  node: string | null;
  next: string | null;
  /** The node it came from (to round the corner it is taking). */
  prev?: string | null;
  progress: number;
  /** Cleared route after `next`. */
  route: string[];

  /** Arrivals: assigned stand. Departures: the stand they left. */
  stand: string;
  /** Ground controller said hold position. */
  held: boolean;
  crossingRequested: boolean;
  crossingCleared: boolean;
  /** Lined up and cleared for takeoff by the tower. */
  takeoffCleared: boolean;
  /** Departure handed to the tower: the runway node it lines up on, and when it joined the queue. */
  lineupNode: string | null;
  queuedTick: number;
  /** Arrival: the holding position it turns off the runway through. */
  exitHold: string | null;
  /** Arrival rolling out: the runway node it will turn off at. */
  exitNode: string | null;
  /** Arrival still vacating: stops at the end of its exit route by itself. */
  vacating: boolean;
  /** Runway in use for this flight (landing, lining up, taking off). */
  runway: string | null;
  /** Metres to the threshold on final, or along the runway from the threshold when landing / taking off. */
  runwayDist: number;
  /** Ticks left in a timed phase (engine start, line-up pause, parked before leaving). */
  timer: number;

  inConflict: boolean;
  spawnTick: number;
  /** Tick the departure asked for pushback / the arrival vacated: for delay statistics. */
  phaseTick: number;
}

export type GroundCommand =
  | { type: 'pushback'; callsign: string; face: 'E' | 'W' | 'N' | 'S' }
  /** Route as explicit nodes (from the map), or a destination with optional taxiways to follow (typed). */
  | { type: 'taxi'; callsign: string; route?: string[]; to?: string; via?: string[] }
  | { type: 'hold'; callsign: string }
  | { type: 'continue'; callsign: string }
  | { type: 'cross'; callsign: string };

export interface GroundLoggedCommand {
  tick: number;
  command: GroundCommand;
}

export type GroundEvent =
  | { type: 'spawned'; tick: number; callsign: string; isArrival: boolean; stand: string }
  | { type: 'pushbackRequested'; tick: number; callsign: string; stand: string }
  | { type: 'readyToTaxi'; tick: number; callsign: string }
  | { type: 'holdingShort'; tick: number; callsign: string; at: string; reason: 'crossing' | 'held' }
  | { type: 'crossingCleared'; tick: number; callsign: string; at: string }
  | { type: 'handedToTower'; tick: number; callsign: string; runway: string; at: string; intersection: boolean }
  | { type: 'wrongHoldingPoint'; tick: number; callsign: string; at: string; runway: string; reason: string }
  | { type: 'linedUp'; tick: number; callsign: string; runway: string }
  | { type: 'departed'; tick: number; callsign: string; runway: string; taxiSec: number }
  | { type: 'touchdown'; tick: number; callsign: string; runway: string; exit: string }
  | { type: 'vacated'; tick: number; callsign: string; via: string }
  | { type: 'parked'; tick: number; callsign: string; stand: string; taxiSec: number }
  | { type: 'goAround'; tick: number; callsign: string; reason: string }
  | { type: 'conflict'; tick: number; a: string; b: string; distance: number }
  | { type: 'runwayChanged'; tick: number; runway: string }
  | { type: 'commandAccepted'; tick: number; callsign: string; message: string }
  | { type: 'commandRejected'; tick: number; callsign: string; message: string };

export interface GroundStats {
  score: number;
  departed: number;
  parked: number;
  conflicts: number;
  goArounds: number;
  /** Sums for averages, seconds. */
  taxiOutSec: number;
  taxiInSec: number;
  commandsIssued: number;
}

export interface GroundState {
  tick: number;
  time: number;
  wind: Wind;
  runway: string; // runway end in use
  aircraft: GroundAircraft[];
  stats: GroundStats;
}

export interface GroundTraffic {
  /** Seconds between departures becoming ready / arrivals appearing on final. */
  departures: { minIntervalSec: number; maxIntervalSec: number; firstSec: number };
  arrivals: { minIntervalSec: number; maxIntervalSec: number; firstSec: number };
}

export interface GroundScenario {
  seed: number;
  airport: GroundAirport;
  traffic: GroundTraffic;
  /** Variable wind (may change the runway in use) or fixed. */
  windVariable: boolean;
  initialWind?: Wind;
}
