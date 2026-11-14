// Ground controller simulation. Pure TypeScript, deterministic, headless, like
// the radar engine: same scenario + same commands at the same ticks = same state.
//
// The player is the ground controller: pushback, taxi routes, holding, and
// asking the tower for runway crossings. Everything airborne and the tower are
// automatic:
//  - arrivals fly a straight final, land if the runway is clear (else go around),
//    roll out and turn off at the first exit they can make on their stand's side,
//    then stop just past the holding position and wait for taxi instructions;
//  - departures that reach the holding point of the runway in use are handed to
//    the tower, which lines them up and clears them for takeoff when no arrival
//    is close and the runway is clear;
//  - crossings are approved when the runway is clear and no arrival is close.
//
// Pilots keep their distance from traffic ahead going the same way, but they do
// not resolve head-on or intersection conflicts: that is the controller's job.

import type { WeightCategory, Wind } from '../types.js';
import { TYPE_DATA, performanceOf, takeoffRunNeeded, type TypeData } from '../aircraft/performance.js';
import { departureWakeSec, wakeRank } from '../rules/wake.js';
import { createRng, nextFloat, nextInt, pick, type RngState } from '../rng.js';
import { initialWind, updateWind, WIND_UPDATE_SEC } from '../weather.js';
import { TaxiGraph, bearing, turn } from './graph.js';
import type {
  GroundAircraft,
  GroundAirport,
  GroundCommand,
  GroundEvent,
  GroundLoggedCommand,
  GroundRunwayEnd,
  GroundScenario,
  GroundState,
} from './types.js';

export const GROUND_DT = 0.5;

const KT = 1852 / 3600; // m/s per kt
export const TAXI_KT = 20;
const TURN_KT = 10;
const APRON_KT = 12;
const STAND_KT = 5;
const CONNECTOR_KT = 15;
const PUSH_KT = 3;
const LINEUP_KT = 8;
const EXIT_KT = 15;
/** Landing aircraft brake to this, then keep it until they need to slow for their exit. */
const RUNWAY_TAXI_KT = 30;
/** The tower lines a departure up behind landing traffic once it is this far down the runway, m. */
const LINEUP_BEHIND_M = 600;
const TAXI_ACCEL = 1.0; // kt/s
const TAXI_DECEL = 2.0; // kt/s
/** Pilots stop this far behind traffic ahead going the same way, m. */
export const FOLLOW_GAP_M = 70;
/** Closer than this (centres) is a ground conflict, m. */
export const CONFLICT_M = 40;
const PATH_WIDTH_M = 25;
const LOOKAHEAD_M = 400;
const START_SEC = 30;
const LINEUP_PAUSE_SEC = 8;
const PARKED_LEAVE_SEC = 20;
const READY_AFTER_SEC = 10;
const TOUCHDOWN_M = 300;
const FINAL_SPAWN_M = 8 * 1852;
/** Arrivals at least 6 nm apart: room for a departure between them, as at a mixed-mode runway. */
const ARRIVAL_SPACING_M = 6 * 1852;
/** Tower: no line-up when an arrival is closer than this, s; no crossing closer than this. */
const LINEUP_ARRIVAL_SEC = 90;
/** A crossing is approved only if nobody is this close to the holding position on the far side, m. */
const FAR_SIDE_CLEAR_M = 60;
const CROSS_ARRIVAL_SEC = 60;
/** Minimum time between takeoffs on top of wake spacing, s. */
const DEPARTURE_GAP_SEC = 60;
/** The tower lines a departure up when it will be clear to go within this many seconds. */
const LINEUP_EARLY_SEC = 30;
/** Departures ready within this of the earliest compete on weight: the lighter goes first, s. */
const PRIORITY_WINDOW_SEC = 45;
/** Time allowed for landing traffic ahead to vacate when lining up behind it, s. */
const VACATE_ALLOWANCE_SEC = 45;
const GO_AROUND_REJOIN_M = 12 * 1852;
const MAX_TAILWIND_KT = 5;
const CARGO_SHARE = 0.25;

export const GROUND_SCORE = {
  departed: 10,
  parked: 10,
  conflict: -20,
  goAround: -5,
} as const;

const WEATHER_SALT = 0x9e3779b9;

export class GroundSimulation {
  readonly scenario: GroundScenario;
  readonly airport: GroundAirport;
  readonly graph: TaxiGraph;
  readonly dt = GROUND_DT;

  private state: GroundState;
  private rng: RngState;
  private weatherRng: RngState;
  private events: GroundEvent[] = [];
  private log: GroundLoggedCommand[] = [];
  private nextId = 1;
  private nextDeparture: number;
  private nextArrival: number;
  private lastTakeoffTick = -1_000_000;
  private lastTakeoffCategory: WeightCategory = 'light';
  private conflictPairs = new Set<string>();
  private usedCallsigns = new Set<string>();
  /** The runway the wind calls for; with crossing runways the switch waits until both are empty. */
  private wantRunway: string;

  constructor(scenario: GroundScenario) {
    this.scenario = scenario;
    this.airport = scenario.airport;
    this.graph = new TaxiGraph(scenario.airport);
    this.rng = createRng(scenario.seed);
    this.weatherRng = createRng((scenario.seed ^ WEATHER_SALT) >>> 0);
    const wind = initialWind({ variable: scenario.windVariable, initialWind: scenario.initialWind }, this.weatherRng);
    const first = this.bestRunway(wind, null);
    this.graph.setRunway(this.airport.runways.find((r) => r.id === first)?.name);
    this.state = {
      tick: 0,
      time: 0,
      wind,
      runway: first,
      aircraft: [],
      stats: { score: 0, departed: 0, parked: 0, conflicts: 0, goArounds: 0, taxiOutSec: 0, taxiInSec: 0, commandsIssued: 0 },
    };
    this.wantRunway = first;
    this.nextDeparture = Math.round(scenario.traffic.departures.firstSec / GROUND_DT);
    this.nextArrival = Math.round(scenario.traffic.arrivals.firstSec / GROUND_DT);
  }

  get tick(): number {
    return this.state.tick;
  }

  getState(): GroundState {
    return this.state;
  }

  drainEvents(): GroundEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  getCommandLog(): readonly GroundLoggedCommand[] {
    return this.log;
  }

  runwayEnd(id = this.state.runway): GroundRunwayEnd {
    return this.airport.runways.find((r) => r.id === id) ?? this.airport.runways[0];
  }

  /** A runway change is pending, waiting for the runways to empty. */
  get switchPending(): boolean {
    return this.wantRunway !== this.state.runway;
  }

  /**
   * Switching between crossing runways needs both clear of traffic. Single-runway
   * airports switch at once (arrivals re-position onto the other end's final).
   */
  private canSwitch(): boolean {
    if (!this.graph.multiRunway) return true;
    for (const a of this.state.aircraft) {
      if (a.status === 'final' || a.status === 'landing' || a.status === 'lineup' || a.status === 'takeoff') return false;
      for (const id of [a.node, a.next]) if (id && this.graph.node(id).rwys) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Tick

  step(): void {
    const s = this.state;
    const tick = s.tick;

    if (this.scenario.windVariable && tick > 0 && tick % Math.round(WIND_UPDATE_SEC / GROUND_DT) === 0) {
      updateWind(s.wind, this.weatherRng);
      this.wantRunway = this.bestRunway(s.wind, s.runway);
    }
    if (this.wantRunway !== s.runway && this.canSwitch()) {
      const rwy = this.wantRunway;
      s.runway = rwy;
      this.graph.setRunway(this.runwayEnd(rwy).name);
      this.events.push({ type: 'runwayChanged', tick, runway: rwy });
      for (const ac of s.aircraft) {
        if (ac.status !== 'handoff') continue;
        const dp = ac.node ? this.departurePoint(ac, ac.node) : null;
        if (dp?.ok) {
          ac.lineupNode = dp.runwayNode;
          continue;
        }
        ac.status = 'taxi';
        this.events.push({ type: 'wrongHoldingPoint', tick, callsign: ac.callsign, at: placeLabel(ac.node ?? ''), runway: rwy, reason: dp?.why ?? 'not a departure point' });
      }
    }

    this.tower(tick);

    for (const ac of s.aircraft) {
      switch (ac.status) {
        case 'parked':
          this.parked(ac, tick);
          break;
        case 'pushback':
          this.pushback(ac);
          break;
        case 'starting':
          if (--ac.timer <= 0) {
            ac.status = 'taxi';
            this.events.push({ type: 'readyToTaxi', tick, callsign: ac.callsign });
          }
          break;
        case 'taxi':
        case 'lineup':
          this.taxi(ac, tick);
          break;
        case 'takeoff':
          this.takeoffRoll(ac, tick);
          break;
        case 'final':
          this.final(ac, tick);
          break;
        case 'landing':
          this.rollout(ac);
          break;
        default:
          break;
      }
    }
    s.aircraft = s.aircraft.filter((a) => a.status !== ('gone' as never));

    this.checkConflicts(tick);
    this.spawn(tick);

    s.tick = tick + 1;
    s.time = s.tick * GROUND_DT;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  // -------------------------------------------------------------------------
  // Commands

  command(cmd: GroundCommand): { ok: boolean; message: string } {
    const r = this.apply(cmd);
    const tick = this.state.tick;
    if (r.ok) {
      this.log.push({ tick, command: cmd });
      this.state.stats.commandsIssued++;
      this.events.push({ type: 'commandAccepted', tick, callsign: cmd.callsign, message: r.message });
    } else {
      this.events.push({ type: 'commandRejected', tick, callsign: cmd.callsign, message: r.message });
    }
    return r;
  }

  /**
   * Place an aircraft directly (tests and set pieces). Departures: at their stand
   * ('ready' to push) or stopped at a node ('taxi'). Arrivals: on final at `finalDist` m.
   */
  addAircraft(spec: {
    callsign: string;
    isArrival: boolean;
    stand: string;
    type?: string;
    status?: 'ready' | 'taxi' | 'final';
    node?: string;
    heading?: number;
    finalDist?: number;
  }): GroundAircraft {
    const stand = this.airport.stands.find((x) => x.id === spec.stand);
    const ac = this.newAircraft(spec.isArrival, stand?.cargo ?? false, spec.stand, this.state.tick);
    ac.callsign = spec.callsign.toUpperCase();
    if (spec.type) {
      const d = TYPE_DATA.find((t) => t.type === spec.type);
      if (d) {
        ac.type = d.type;
        ac.category = d.category;
      }
    }
    const status = spec.status ?? (spec.isArrival ? 'final' : 'ready');
    ac.status = status;
    if (status === 'final') {
      ac.runwayDist = spec.finalDist ?? 5000;
      ac.runway = this.state.runway;
      this.placeOnRunway(ac, this.runwayEnd(), -ac.runwayDist);
      ac.speed = performanceOf(ac).approachSpeed;
    } else {
      ac.node = spec.node ?? spec.stand;
      const n = this.graph.node(ac.node);
      ac.x = n.x;
      ac.y = n.y;
      ac.heading = spec.heading ?? stand?.heading ?? 0;
    }
    this.state.aircraft.push(ac);
    return ac;
  }

  /** Plan a route for an aircraft through clicked points, without issuing it. */
  planRoute(callsign: string, waypoints: readonly string[]): string[] | null {
    const ac = this.find(callsign);
    if (!ac) return null;
    const from = this.routeStart(ac);
    if (!from) return null;
    return this.graph.routeThrough(from.start, from.prev, from.heading, waypoints);
  }

  /** Where a new route for this aircraft starts: the node it is at, or the one it is taxiing to. */
  routeStart(ac: GroundAircraft): { start: string; prev: string | null; heading: number | null } | null {
    if (ac.status === 'starting' || (ac.status === 'taxi' && !ac.vacating)) {
      if (ac.next) return { start: ac.next, prev: ac.node, heading: null };
      if (ac.node) return { start: ac.node, prev: null, heading: ac.heading };
    }
    return null;
  }

  private apply(cmd: GroundCommand): { ok: boolean; message: string } {
    const ac = this.find(cmd.callsign);
    if (!ac) return { ok: false, message: `${cmd.callsign}: no such aircraft` };
    const cs = ac.callsign;
    switch (cmd.type) {
      case 'pushback': {
        if (ac.status !== 'ready') {
          return { ok: false, message: ac.status === 'parked' ? `${cs} has not requested pushback` : `${cs} is not at the stand` };
        }
        const stand = this.airport.stands.find((s) => s.id === ac.stand);
        if (!stand) return { ok: false, message: `${cs}: no stand` };
        const face = { N: 0, E: 90, S: 180, W: 270 }[cmd.face];
        const along = this.graph
          .neighbors(stand.pushNode)
          .filter((n) => n.edge.kind === 'taxilane' || n.edge.kind === 'link')
          .some((n) => turn(n.bearing, face) < 50);
        if (!along) return { ok: false, message: `${cs} cannot face ${cmd.face} after pushback from ${stand.id}` };
        ac.status = 'pushback';
        ac.node = stand.id;
        ac.next = stand.pushNode;
        ac.progress = 0;
        ac.timer = face; // heading to take at the end of the push
        ac.speed = 0;
        return { ok: true, message: `${cs} push back from ${stand.id}, face ${({ N: 'north', E: 'east', S: 'south', W: 'west' })[cmd.face]}` };
      }
      case 'taxi': {
        const from = this.routeStart(ac);
        if (!from) {
          if (ac.status === 'ready' || ac.status === 'parked') return { ok: false, message: `${cs} needs pushback first` };
          if (ac.vacating) return { ok: false, message: `${cs} is still vacating the runway` };
          return { ok: false, message: `${cs} is not taxiing` };
        }
        let route: string[] | null;
        if (cmd.route && cmd.route.length > 0) {
          route = [...cmd.route];
          if (route[0] !== from.start) route.unshift(from.start);
          const why = this.graph.checkRoute(route, from.prev, from.heading);
          if (why) return { ok: false, message: `${cs} unable: ${why}` };
        } else if (cmd.to) {
          const goal = this.resolvePlace(cmd.to);
          if (!goal) return { ok: false, message: `${cs}: unknown destination ${cmd.to}` };
          route = this.graph.route(from.start, from.prev, from.heading, goal, cmd.via ?? []);
          if (!route) {
            return { ok: false, message: `${cs}: no route to ${cmd.to}${cmd.via?.length ? ` via ${cmd.via.join(' ')}` : ''}` };
          }
        } else {
          return { ok: false, message: `${cs}: taxi where?` };
        }
        const goal = route[route.length - 1];
        if (this.graph.isStand(goal) && (!ac.isArrival || goal !== ac.stand)) {
          return { ok: false, message: ac.isArrival ? `${cs} is assigned stand ${ac.stand}` : `${cs} is departing, not parking` };
        }
        // Keep the current edge: the new route starts at `next` (or the node it is stopped at).
        ac.route = route.slice(1);
        ac.held = false;
        ac.crossingCleared = false;
        ac.crossingRequested = false;
        if (ac.status === 'taxi') this.advance(ac);
        const crossing = this.crossingAhead(ac);
        const names = this.routeNames(route);
        return {
          ok: true,
          message: `${cs} taxi to ${placeLabel(goal)} via ${names.join(' ') || 'present position'}${crossing ? `, hold short of runway at ${placeLabel(crossing)}` : ''}`,
        };
      }
      case 'hold': {
        if (ac.status !== 'taxi' || this.onRunwayArea(ac)) return { ok: false, message: `${cs} cannot hold here` };
        ac.held = true;
        return { ok: true, message: `${cs} hold position` };
      }
      case 'continue': {
        if (!ac.held) return { ok: false, message: `${cs} is not holding` };
        ac.held = false;
        return { ok: true, message: `${cs} continue taxi` };
      }
      case 'cross': {
        const at = this.crossingAhead(ac);
        if (ac.status !== 'taxi' || !at) return { ok: false, message: `${cs} has no runway crossing ahead` };
        ac.crossingRequested = true;
        return { ok: true, message: `${cs} requesting to cross runway at ${placeLabel(at)}` };
      }
    }
  }

  /** "A5" -> holding point node A5h; "S3" -> stand S3; a node id as is. */
  resolvePlace(name: string): string | null {
    const up = name.toUpperCase();
    if (this.graph.has(`${up}h`)) return `${up}h`;
    if (this.graph.has(up)) return up;
    return null;
  }

  private find(callsign: string): GroundAircraft | undefined {
    const want = callsign.toUpperCase();
    return this.state.aircraft.find((a) => a.callsign === want);
  }

  // -------------------------------------------------------------------------
  // Phases

  private parked(ac: GroundAircraft, tick: number): void {
    if (--ac.timer > 0) return;
    if (ac.isArrival) {
      (ac as { status: string }).status = 'gone';
      return;
    }
    ac.status = 'ready';
    ac.phaseTick = tick;
    this.events.push({ type: 'pushbackRequested', tick, callsign: ac.callsign, stand: ac.stand });
  }

  private pushback(ac: GroundAircraft): void {
    const from = this.graph.node(ac.node!);
    const to = this.graph.node(ac.next!);
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    ac.speed = PUSH_KT;
    ac.progress += PUSH_KT * KT * GROUND_DT;
    const f = Math.min(1, ac.progress / len);
    ac.x = from.x + (to.x - from.x) * f;
    ac.y = from.y + (to.y - from.y) * f;
    if (f < 1) return;
    ac.heading = ac.timer;
    ac.node = ac.next;
    ac.next = null;
    ac.progress = 0;
    ac.speed = 0;
    ac.status = 'starting';
    ac.timer = Math.round(START_SEC / GROUND_DT);
  }

  /** Graph motion with speed control (taxi, vacating, crossing, line-up). */
  private taxi(ac: GroundAircraft, tick: number): void {
    if (!ac.next) this.advance(ac);
    const target = this.targetSpeed(ac);
    if (ac.speed < target) ac.speed = Math.min(target, ac.speed + TAXI_ACCEL * GROUND_DT);
    else ac.speed = Math.max(target, ac.speed - TAXI_DECEL * GROUND_DT);
    if (!ac.next) {
      ac.speed = 0;
      return;
    }
    let move = ac.speed * KT * GROUND_DT;
    while (move > 0 && ac.next) {
      const a = this.graph.node(ac.node!);
      const b = this.graph.node(ac.next);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const left = len - ac.progress;
      if (move < left) {
        ac.progress += move;
        move = 0;
      } else {
        move -= left;
        this.arrive(ac, tick);
        if (!ac.next) move = 0;
      }
    }
    this.place(ac);
  }

  /** The aircraft reached `next`. */
  private arrive(ac: GroundAircraft, tick: number): void {
    const prev = ac.node;
    ac.node = ac.next;
    ac.progress = 0;
    const here = this.graph.node(ac.node!);
    // Done crossing once past the far holding position.
    if (here.holdShort && prev && this.graph.node(prev).onRunway) {
      ac.crossingCleared = false;
      ac.crossingRequested = false;
    }
    if (ac.status === 'lineup' && here.onRunway) {
      const rwy = this.runwayEnd(ac.runway ?? this.state.runway);
      ac.next = null;
      ac.heading = rwy.heading;
      ac.speed = 0;
      ac.status = 'takeoff';
      ac.runwayDist = this.alongRunway(rwy, here);
      ac.timer = Math.round(LINEUP_PAUSE_SEC / GROUND_DT);
      this.events.push({ type: 'linedUp', tick, callsign: ac.callsign, runway: rwy.id });
      return;
    }
    ac.next = null;
    if (ac.route.length > 0) {
      if (this.gateClosed(ac)) {
        // Holding short of the runway until the tower clears the crossing; the route is kept.
        ac.speed = 0;
        this.events.push({ type: 'holdingShort', tick, callsign: ac.callsign, at: placeLabel(ac.node!), reason: 'crossing' });
        return;
      }
      this.advance(ac);
      return;
    }

    // End of the route.
    ac.speed = 0;
    if (ac.vacating) {
      ac.vacating = false;
      ac.phaseTick = tick;
      this.events.push({ type: 'vacated', tick, callsign: ac.callsign, via: placeLabel(ac.node!) });
      return;
    }
    if (ac.isArrival && ac.node === ac.stand) {
      const stand = this.airport.stands.find((s) => s.id === ac.stand);
      ac.heading = stand?.heading ?? ac.heading;
      ac.status = 'parked';
      ac.timer = Math.round(PARKED_LEAVE_SEC / GROUND_DT);
      const taxiSec = (tick - ac.phaseTick) * GROUND_DT;
      this.state.stats.parked++;
      this.state.stats.taxiInSec += taxiSec;
      this.state.stats.score += GROUND_SCORE.parked;
      this.events.push({ type: 'parked', tick, callsign: ac.callsign, stand: ac.stand, taxiSec });
      return;
    }
    if (!ac.isArrival && here.holdShort) {
      const rwy = this.runwayEnd();
      const dp = this.departurePoint(ac, ac.node!);
      if (dp?.ok) {
        ac.status = 'handoff';
        ac.lineupNode = dp.runwayNode;
        ac.queuedTick = tick;
        this.events.push({ type: 'handedToTower', tick, callsign: ac.callsign, runway: rwy.id, at: placeLabel(ac.node!), intersection: dp.intersection });
      } else if (dp) {
        this.events.push({ type: 'wrongHoldingPoint', tick, callsign: ac.callsign, at: placeLabel(ac.node!), runway: rwy.id, reason: dp.why });
      }
    }
  }

  /**
   * Can this departure take off on the runway in use from holding position `hold`?
   * Full length from the runway's own holding point, or an intersection part-way
   * down if enough runway is left for its type.
   */
  departurePoint(
    ac: GroundAircraft,
    hold: string,
  ): { ok: boolean; runwayNode: string; remaining: number; intersection: boolean; why: string } | null {
    const h = this.graph.node(hold);
    if (!h.holdShort) return null;
    const rnb = this.graph.neighbors(hold).find((n) => this.graph.node(n.to).onRunway);
    if (!rnb || this.graph.node(rnb.to).crossing) return null;
    const rwy = this.runwayEnd();
    const far = this.runwayEnd(rwy.oppositeId);
    const s0 = this.alongRunway(rwy, this.graph.node(rnb.to));
    const endAt = this.alongRunway(rwy, { x: rwy.endX ?? far.thresholdX, y: rwy.endY ?? far.thresholdY });
    // A line-up before the threshold (a full-length start) counts from the start of the pavement.
    const remaining = Math.round(endAt - (rwy.endX === undefined ? Math.max(0, s0) : s0));
    const intersection = rnb.to !== rwy.lineupNode;
    const needed = Math.round(takeoffRunNeeded(ac) * (rwy.takeoffFactor ?? 1));
    if (remaining < 200) return { ok: false, runwayNode: rnb.to, remaining, intersection, why: `${placeLabel(hold)} is at the far end of runway ${rwy.id}` };
    if (remaining < needed) {
      return { ok: false, runwayNode: rnb.to, remaining, intersection, why: `${placeLabel(hold)} leaves ${remaining.toLocaleString('en-US')} m, ${ac.type} needs ${needed.toLocaleString('en-US')} m` };
    }
    return { ok: true, runwayNode: rnb.to, remaining, intersection, why: '' };
  }

  /** Holding positions this departure could take off from on the runway in use, best (full length) first. */
  departureOptions(ac: GroundAircraft): { hold: string; remaining: number; intersection: boolean }[] {
    const out: { hold: string; remaining: number; intersection: boolean }[] = [];
    for (const n of this.graph.nodes.values()) {
      if (!n.holdShort) continue;
      const dp = this.departurePoint(ac, n.id);
      if (dp?.ok) out.push({ hold: n.id, remaining: dp.remaining, intersection: dp.intersection });
    }
    return out.sort((a, b) => b.remaining - a.remaining);
  }

  /** Seconds before this departure may start its takeoff roll (minimum gap and wake turbulence). */
  private departureWait(ac: GroundAircraft, intersection: boolean, tick: number): number {
    const since = (tick - this.lastTakeoffTick) * GROUND_DT;
    const need = Math.max(DEPARTURE_GAP_SEC, departureWakeSec(this.lastTakeoffCategory, ac.category, intersection));
    return Math.max(0, need - since);
  }

  /** Stopped at a holding position with the runway next and no crossing clearance. */
  private gateClosed(ac: GroundAircraft): boolean {
    if (!ac.node || ac.route.length === 0 || ac.crossingCleared || ac.status === 'lineup') return false;
    return this.graph.node(ac.node).holdShort === true && this.graph.node(ac.route[0]).onRunway === true;
  }

  /** Stopped at a node with a route ahead: take the next leg unless held short of the runway. */
  private advance(ac: GroundAircraft): void {
    if (ac.next || ac.route.length === 0 || this.gateClosed(ac)) return;
    ac.next = ac.route.shift() ?? null;
    ac.progress = 0;
  }

  private targetSpeed(ac: GroundAircraft): number {
    if (ac.status === 'lineup') return LINEUP_KT;
    if (!ac.next) return 0;
    if (ac.held && !this.onRunwayArea(ac)) return 0;

    // Walk the path ahead: edge limits, turns, and where it must stop.
    let limit = this.edgeLimit(ac.node!, ac.next);
    let dist = this.edgeLen(ac.node!, ac.next) - ac.progress;
    const path = [ac.node!, ac.next, ...ac.route];
    for (let i = 1; i < path.length && dist < LOOKAHEAD_M; i++) {
      const at = path[i];
      let vNode: number;
      const after = path[i + 1];
      const stop =
        i === path.length - 1 || (this.graph.node(at).holdShort === true && after !== undefined && this.graph.node(after).onRunway === true && !ac.crossingCleared);
      if (stop) vNode = 0;
      else {
        const t = turn(bearing(this.graph.node(path[i - 1]), this.graph.node(at)), bearing(this.graph.node(at), this.graph.node(path[i + 1])));
        vNode = Math.min(t > 30 ? TURN_KT : TAXI_KT, this.edgeLimit(at, path[i + 1]));
      }
      limit = Math.min(limit, brakeTo(vNode, dist));
      if (stop) break;
      if (i + 1 < path.length) dist += this.edgeLen(at, path[i + 1]);
    }

    // Traffic ahead on the path, going the same way. Never stop on the runway for it:
    // the tower only lets an aircraft onto the runway when the way off is clear.
    if (!this.onRunwayArea(ac)) {
      const gap = this.trafficGap(ac, path);
      if (gap !== null) limit = Math.min(limit, brakeTo(0, gap - FOLLOW_GAP_M));
    }
    return Math.max(0, limit);
  }

  /** Distance to the nearest aircraft on the path ahead going roughly the same way, m. */
  private trafficGap(ac: GroundAircraft, path: string[]): number | null {
    let best: number | null = null;
    // Path polyline from the current position.
    const pts: { x: number; y: number }[] = [{ x: ac.x, y: ac.y }];
    for (let i = 1; i < path.length; i++) pts.push(this.graph.node(path[i]));
    for (const other of this.state.aircraft) {
      if (other === ac || other.status === 'final' || other.status === 'parked' || other.status === 'ready') continue;
      if (Math.abs(other.x - ac.x) > LOOKAHEAD_M || Math.abs(other.y - ac.y) > LOOKAHEAD_M) continue;
      let along = 0;
      for (let i = 1; i < pts.length && along < LOOKAHEAD_M; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((other.x - a.x) * (b.x - a.x) + (other.y - a.y) * (b.y - a.y)) / (seg * seg)));
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        if (Math.hypot(other.x - px, other.y - py) < PATH_WIDTH_M && (i > 1 || t > 0)) {
          // Wait for traffic ahead going the same way or crossing our path; not for head-on
          // traffic (that is a conflict for the controller to prevent). If each is on the
          // other's path (an intersection), the lower id goes first.
          const sameWay = turn(other.heading, bearing(a, b)) < 100;
          const mutual = this.isAhead(other, ac);
          if (sameWay && !(mutual && ac.id < other.id)) {
            const d = along + seg * t;
            if (d > 1 && (best === null || d < best)) best = d;
          }
          break;
        }
        along += seg;
      }
    }
    return best;
  }

  /** Is `target` on `viewer`'s path within the follow distance (for the intersection tie-break)? */
  private isAhead(viewer: GroundAircraft, target: GroundAircraft): boolean {
    if (viewer.status !== 'taxi' || !viewer.next) return false;
    const pts = [{ x: viewer.x, y: viewer.y }, ...[viewer.next, ...viewer.route].map((id) => this.graph.node(id))];
    let along = 0;
    for (let i = 1; i < pts.length && along < FOLLOW_GAP_M * 2; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / (seg * seg)));
      if (Math.hypot(target.x - (a.x + (b.x - a.x) * t), target.y - (a.y + (b.y - a.y) * t)) < PATH_WIDTH_M) return true;
      along += seg;
    }
    return false;
  }

  private takeoffRoll(ac: GroundAircraft, tick: number): void {
    if (ac.timer > 0) ac.timer--;
    if (!ac.takeoffCleared) return; // lined up and waiting for the tower
    const perf = performanceOf(ac);
    const rwy = this.runwayEnd(ac.runway ?? this.state.runway);
    const v0 = ac.speed;
    ac.speed = Math.min(perf.rotateSpeed, ac.speed + perf.takeoffAccel * GROUND_DT);
    ac.runwayDist += ((v0 + ac.speed) / 2) * KT * GROUND_DT;
    this.placeOnRunway(ac, rwy, ac.runwayDist);
    if (ac.speed < perf.rotateSpeed) return;
    const taxiSec = (tick - ac.phaseTick) * GROUND_DT;
    this.state.stats.departed++;
    this.state.stats.taxiOutSec += taxiSec;
    this.state.stats.score += GROUND_SCORE.departed;
    this.events.push({ type: 'departed', tick, callsign: ac.callsign, runway: rwy.id, taxiSec });
    (ac as { status: string }).status = 'gone';
  }

  private final(ac: GroundAircraft, tick: number): void {
    const perf = performanceOf(ac);
    const rwy = this.runwayEnd();
    ac.runway = rwy.id;
    ac.speed = perf.approachSpeed;
    ac.runwayDist -= ac.speed * KT * GROUND_DT;
    this.placeOnRunway(ac, rwy, -ac.runwayDist);
    ac.heading = rwy.heading;
    if (ac.runwayDist > 0) return;
    const blocker = this.runwayOccupant(ac);
    if (blocker) {
      this.state.stats.goArounds++;
      this.state.stats.score += GROUND_SCORE.goAround;
      this.events.push({ type: 'goAround', tick, callsign: ac.callsign, reason: `runway occupied by ${blocker}` });
      ac.runwayDist = GO_AROUND_REJOIN_M;
      return;
    }
    ac.status = 'landing';
    ac.runwayDist = 0;
    ac.speed = perf.touchdownSpeed;
    ac.exitNode = this.chooseExit(ac, rwy);
    this.events.push({ type: 'touchdown', tick, callsign: ac.callsign, runway: rwy.id, exit: placeLabel(this.exitHold(ac)) });
  }

  private rollout(ac: GroundAircraft): void {
    const perf = performanceOf(ac);
    const rwy = this.runwayEnd(ac.runway ?? this.state.runway);
    const exitAt = this.alongRunway(rwy, this.graph.node(ac.exitNode!));
    const v0 = ac.speed;
    if (ac.runwayDist >= TOUCHDOWN_M) {
      // Brake to runway taxi speed, and harder only if needed to make the exit at exit speed.
      const a = perf.rolloutDecel * KT;
      const curve = Math.sqrt((EXIT_KT * KT) ** 2 + 2 * a * Math.max(0, exitAt - ac.runwayDist)) / KT;
      ac.speed = Math.max(EXIT_KT, Math.min(Math.max(RUNWAY_TAXI_KT, ac.speed - perf.rolloutDecel * GROUND_DT), curve));
    }
    const step = ((v0 + ac.speed) / 2) * KT * GROUND_DT;
    if (ac.runwayDist + step < exitAt) {
      ac.runwayDist += step;
      this.placeOnRunway(ac, rwy, ac.runwayDist);
      return;
    }
    // Turn off onto the exit connector; taxi to just past the holding position and stop.
    const hold = this.exitHold(ac);
    const clear = this.graph.neighbors(hold).find((n) => !this.graph.node(n.to).onRunway)!.to;
    ac.status = 'taxi';
    ac.vacating = true;
    ac.node = ac.exitNode;
    ac.next = hold;
    ac.route = [clear];
    ac.progress = 0;
    ac.speed = Math.min(ac.speed, EXIT_KT);
    ac.heading = bearing(this.graph.node(ac.exitNode!), this.graph.node(hold));
    ac.crossingCleared = true; // leaving the runway, not entering it
    this.place(ac);
  }

  // -------------------------------------------------------------------------
  // Tower

  private tower(tick: number): void {
    const s = this.state;
    const rwy = this.runwayEnd();
    const eta = this.nextArrivalSec();
    const occupied = this.runwayOccupant(null) !== null;

    // Crossings first (they are quick): one at a time, runway clear, no arrival close,
    // and the far side clear so it never has to stop on the runway. Then departures.
    const lining = s.aircraft.some((a) => a.status === 'lineup' || a.status === 'takeoff');
    if (!occupied && !lining && eta >= CROSS_ARRIVAL_SEC) {
      for (const ac of s.aircraft) {
        if (ac.status !== 'taxi' || !ac.crossingRequested || ac.crossingCleared || ac.next !== null) continue;
        const here = ac.node ? this.graph.node(ac.node) : null;
        if (!here?.holdShort || !ac.route[0] || !this.graph.node(ac.route[0]).onRunway) continue;
        const far = ac.route[1];
        if (far && this.someoneNear(this.graph.node(far), FAR_SIDE_CLEAR_M, ac)) continue;
        ac.crossingCleared = true;
        this.events.push({ type: 'crossingCleared', tick, callsign: ac.callsign, at: placeLabel(ac.node!) });
        return;
      }
    }

    // Takeoff clearance for a lined-up aircraft: runway clear and the next arrival far enough out.
    const lined = s.aircraft.find((a) => a.status === 'takeoff' && !a.takeoffCleared);
    if (lined) {
      const fromInt = lined.lineupNode !== null && lined.lineupNode !== rwy.lineupNode;
      if (
        lined.timer <= 0 &&
        this.runwayOccupant(lined) === null &&
        eta >= this.takeoffSec(lined) + 10 &&
        this.departureWait(lined, fromInt, tick) <= 0
      ) {
        lined.takeoffCleared = true;
        this.lastTakeoffTick = tick;
        this.lastTakeoffCategory = lined.category;
      }
      return;
    }

    // Line up the next departure: nobody else lining up or rolling, no crossing, the next arrival
    // far enough out, and it can go within LINEUP_EARLY_SEC (minimum gap and wake turbulence).
    // Order: whoever can go soonest; on a tie the lighter type first (a heavy then follows
    // without a wake wait, the other way round costs 2 minutes); then first come, first served.
    if (eta < LINEUP_ARRIVAL_SEC) return;
    if (this.switchPending && this.graph.multiRunway) return; // runway change: nobody new onto the runway
    // A crossing waiting at a holding position (with the far side clear) gets the next gap:
    // crossings take seconds, and lining up departures first could keep it waiting for ever.
    const crossingWaiting = s.aircraft.some((ac) => {
      if (ac.status !== 'taxi' || !ac.crossingRequested || ac.crossingCleared || ac.next !== null) return false;
      if (!ac.route[0] || !this.graph.node(ac.route[0]).onRunway) return false;
      const far = ac.route[1];
      return !far || !this.someoneNear(this.graph.node(far), FAR_SIDE_CLEAR_M, ac);
    });
    if (crossingWaiting) return;
    for (const a of s.aircraft) {
      if (a.status === 'lineup' || a.status === 'takeoff') return;
      if (a.status === 'taxi' && this.onRunwayArea(a) && !a.vacating) return;
    }
    // When could each waiting departure line up? Its wake wait, and for landing traffic
    // still short of where it lines up, the time for that aircraft to roll past.
    const candidates = s.aircraft
      .filter((a) => a.status === 'handoff' && a.lineupNode !== null)
      .map((a) => {
        const node = this.graph.node(a.lineupNode!);
        const fromInt = a.lineupNode !== rwy.lineupNode;
        const s0 = this.alongRunway(rwy, node);
        let pass = 0;
        for (const l of s.aircraft) {
          if (l.status !== 'landing' || l.runwayDist >= s0 + LINEUP_BEHIND_M) continue;
          pass = Math.max(pass, (s0 + LINEUP_BEHIND_M - l.runwayDist) / Math.max(l.speed * KT, 5));
        }
        const wait = this.departureWait(a, fromInt, tick);
        return { a, wait, pass, ready: Math.max(wait, pass) };
      });
    if (candidates.length === 0) return;
    // Lighter first among those ready within PRIORITY_WINDOW_SEC of the earliest: a heavy
    // behind a lighter aircraft needs no wake wait, the other way round costs 2-3 minutes.
    // So a light at an intersection goes before a heavy at the runway end, even if it has to
    // wait a few seconds more for landing traffic to pass. Then first come, first served.
    const earliest = Math.min(...candidates.map((c) => c.ready));
    const pick = candidates
      .filter((c) => c.ready <= earliest + PRIORITY_WINDOW_SEC)
      .sort((p, q) => wakeRank(p.a.category) - wakeRank(q.a.category) || p.ready - q.ready || p.a.queuedTick - q.a.queuedTick)[0];
    if (pick.pass > 0 || pick.wait > LINEUP_EARLY_SEC) return; // its turn, but not yet
    // It will sit lined up for its wait as well: the next arrival must still be far enough out.
    // Behind landing traffic it also waits for that aircraft to vacate.
    const behindLanding = s.aircraft.some((a) => a.status === 'landing' || (a.status === 'taxi' && a.vacating && this.onRunwayArea(a)));
    if (eta < LINEUP_ARRIVAL_SEC + pick.wait + (behindLanding ? VACATE_ALLOWANCE_SEC : 0)) return;
    const next = pick.a;
    next.status = 'lineup';
    next.runway = rwy.id;
    next.next = next.lineupNode;
    next.route = [];
    next.progress = 0;
  }

  /** Seconds from brake release to lift-off. */
  private takeoffSec(ac: GroundAircraft): number {
    const p = performanceOf(ac);
    return p.rotateSpeed / p.takeoffAccel;
  }

  private someoneNear(p: { x: number; y: number }, r: number, self: GroundAircraft): boolean {
    return this.state.aircraft.some((a) => a !== self && a.status !== 'final' && Math.hypot(a.x - p.x, a.y - p.y) < r);
  }

  /** Seconds until the next arrival reaches the threshold (Infinity if none). */
  nextArrivalSec(): number {
    let best = Infinity;
    for (const a of this.state.aircraft) {
      if (a.status !== 'final') continue;
      const v = performanceOf(a).approachSpeed * KT;
      best = Math.min(best, a.runwayDist / v);
    }
    return best;
  }

  /** Callsign of an aircraft on the runway (other than `self`), or null. */
  runwayOccupant(self: GroundAircraft | null): string | null {
    for (const a of this.state.aircraft) {
      if (a === self) continue;
      if (a.status === 'landing' || a.status === 'lineup' || a.status === 'takeoff') return a.callsign;
      if (a.status === 'taxi' && this.onRunwayArea(a)) return a.callsign;
    }
    return null;
  }

  /** Between the holding positions: on or about to be on the runway. */
  onRunwayArea(ac: GroundAircraft): boolean {
    const n = ac.node ? this.graph.node(ac.node) : null;
    const nx = ac.next ? this.graph.node(ac.next) : null;
    if (n?.onRunway || nx?.onRunway) return true;
    return false;
  }

  /** The holding position the aircraft will stop at before a runway crossing, if any. */
  crossingAhead(ac: GroundAircraft): string | null {
    const path = [ac.node, ac.next, ...ac.route].filter((x): x is string => !!x);
    for (let i = 0; i + 1 < path.length; i++) {
      const n = this.graph.node(path[i]);
      if (n.holdShort && this.graph.node(path[i + 1]).onRunway) {
        // Not one it is already past (coming off the runway).
        if (i > 0 && this.graph.node(path[i - 1]).onRunway) continue;
        return path[i];
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Runway geometry

  private alongRunway(rwy: GroundRunwayEnd, p: { x: number; y: number }): number {
    const h = (rwy.heading * Math.PI) / 180;
    return (p.x - rwy.thresholdX) * Math.sin(h) + (p.y - rwy.thresholdY) * Math.cos(h);
  }

  /** Which side of the runway a point is on, looking along it: 1 right, -1 left. */
  private sideOf(rwy: GroundRunwayEnd, p: { x: number; y: number }): number {
    const h = (rwy.heading * Math.PI) / 180;
    return Math.sign((p.x - rwy.thresholdX) * Math.cos(h) - (p.y - rwy.thresholdY) * Math.sin(h)) || 1;
  }

  private placeOnRunway(ac: GroundAircraft, rwy: GroundRunwayEnd, s: number): void {
    const h = (rwy.heading * Math.PI) / 180;
    ac.x = rwy.thresholdX + Math.sin(h) * s;
    ac.y = rwy.thresholdY + Math.cos(h) * s;
    ac.heading = rwy.heading;
  }

  /** First runway node it can turn off at, on its stand's side if possible. */
  private chooseExit(ac: GroundAircraft, rwy: GroundRunwayEnd): string {
    const perf = performanceOf(ac);
    const vt = perf.touchdownSpeed * KT;
    const ve = EXIT_KT * KT;
    const a = perf.rolloutDecel * KT;
    const need = TOUCHDOWN_M + (vt * vt - ve * ve) / (2 * a);
    const standSide = this.sideOf(rwy, this.graph.node(ac.stand));
    const exits = [...this.graph.nodes.values()]
      .filter((n) => n.onRunway && !n.crossing)
      .map((n) => ({ n, s: this.alongRunway(rwy, n) }))
      .filter((e) => e.s > TOUCHDOWN_M && e.n.id !== rwy.lineupNode)
      .sort((p, q) => p.s - q.s);
    // A holding position with a departure waiting there (or anyone close) is not a way off.
    const free = (hold: string) => !this.someoneNear(this.graph.node(hold), 60, ac);
    const holds = (id: string) => this.graph.neighbors(id).filter((nb) => this.graph.node(nb.to).holdShort && free(nb.to));
    // Prefer the stand's side; any side otherwise; the far end as the last resort.
    for (const sameSide of [true, false]) {
      for (const e of exits) {
        if (e.s < need) continue;
        const h = holds(e.n.id).find((h) => !sameSide || this.sideOf(rwy, this.graph.node(h.to)) === standSide);
        if (h) {
          ac.exitHold = h.to;
          return e.n.id;
        }
      }
    }
    const last = (exits.length > 0 ? exits[exits.length - 1] : { n: this.graph.node(rwy.lineupNode) }).n.id;
    ac.exitHold = this.graph.neighbors(last).find((nb) => this.graph.node(nb.to).holdShort)?.to ?? null;
    return last;
  }

  /** The holding position an arrival turns off the runway through (chosen at touchdown). */
  private exitHold(ac: GroundAircraft): string {
    return ac.exitHold ?? ac.exitNode ?? '';
  }

  // -------------------------------------------------------------------------
  // Conflicts, spawning, helpers

  private checkConflicts(tick: number): void {
    const s = this.state;
    const live = s.aircraft.filter((a) => a.status !== 'final' && a.status !== 'parked' && a.status !== 'ready');
    for (const a of s.aircraft) a.inConflict = false;
    const now = new Set<string>();
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= CONFLICT_M) continue;
        a.inConflict = b.inConflict = true;
        const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
        now.add(key);
        if (!this.conflictPairs.has(key)) {
          s.stats.conflicts++;
          s.stats.score += GROUND_SCORE.conflict;
          this.events.push({ type: 'conflict', tick, a: a.callsign, b: b.callsign, distance: Math.round(d) });
        }
      }
    }
    this.conflictPairs = now;
  }

  private spawn(tick: number): void {
    const { traffic } = this.scenario;
    if (tick >= this.nextDeparture) {
      const stand = this.freeStand();
      if (stand) {
        const cargo = stand.cargo;
        const ac = this.newAircraft(false, cargo, stand.id, tick);
        const node = this.graph.node(stand.id);
        ac.x = node.x;
        ac.y = node.y;
        ac.heading = stand.heading;
        ac.node = stand.id;
        ac.status = 'parked';
        ac.timer = Math.round(READY_AFTER_SEC / GROUND_DT);
        this.state.aircraft.push(ac);
        this.events.push({ type: 'spawned', tick, callsign: ac.callsign, isArrival: false, stand: stand.id });
      }
      this.nextDeparture = tick + this.interval(traffic.departures);
    }
    if (tick >= this.nextArrival) {
      const last = Math.max(0, ...this.state.aircraft.filter((a) => a.status === 'final').map((a) => a.runwayDist));
      const stand = this.freeStand();
      if (stand && FINAL_SPAWN_M - last >= ARRIVAL_SPACING_M && !(this.switchPending && this.graph.multiRunway)) {
        const ac = this.newAircraft(true, stand.cargo, stand.id, tick);
        ac.status = 'final';
        ac.runwayDist = FINAL_SPAWN_M;
        ac.runway = this.state.runway;
        this.placeOnRunway(ac, this.runwayEnd(), -FINAL_SPAWN_M);
        ac.speed = performanceOf(ac).approachSpeed;
        this.state.aircraft.push(ac);
        this.events.push({ type: 'spawned', tick, callsign: ac.callsign, isArrival: true, stand: stand.id });
        this.nextArrival = tick + this.interval(traffic.arrivals);
      } else {
        this.nextArrival = tick + Math.round(20 / GROUND_DT);
      }
    }
  }

  private interval(p: { minIntervalSec: number; maxIntervalSec: number }): number {
    return Math.max(1, Math.round((p.minIntervalSec + nextFloat(this.rng) * (p.maxIntervalSec - p.minIntervalSec)) / GROUND_DT));
  }

  /** A stand nobody is at or heading for; a cargo stand about one time in four. */
  private freeStand() {
    // Arrivals hold their stand from spawning until they leave; departures until pushback ends.
    const taken = new Set(
      this.state.aircraft
        .filter((a) => a.isArrival || a.status === 'parked' || a.status === 'ready' || a.status === 'pushback')
        .map((a) => a.stand),
    );
    const free = this.airport.stands.filter((s) => !taken.has(s.id));
    if (free.length === 0) return null;
    const wantCargo = nextFloat(this.rng) < CARGO_SHARE;
    const pool = free.filter((s) => s.cargo === wantCargo);
    return pick(this.rng, pool.length > 0 ? pool : free);
  }

  private newAircraft(isArrival: boolean, cargo: boolean, stand: string, tick: number): GroundAircraft {
    const type = this.pickType(this.airport.standFleets?.[stand] ?? (cargo ? this.airport.cargoFleet : this.airport.fleet));
    const airlines = cargo ? this.airport.cargoAirlines : this.airport.airlines;
    let callsign = '';
    for (let i = 0; i < 50 && (!callsign || this.usedCallsigns.has(callsign)); i++) {
      callsign = pick(this.rng, airlines) + String(nextInt(this.rng, 10, 999));
    }
    this.usedCallsigns.add(callsign);
    return {
      id: this.nextId++,
      callsign,
      type: type.type,
      category: type.category as WeightCategory,
      isArrival,
      cargo,
      status: 'parked',
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      node: null,
      next: null,
      progress: 0,
      route: [],
      stand,
      held: false,
      crossingRequested: false,
      crossingCleared: false,
      takeoffCleared: false,
      lineupNode: null,
      queuedTick: 0,
      exitHold: null,
      exitNode: null,
      vacating: false,
      runway: null,
      runwayDist: 0,
      timer: 0,
      inConflict: false,
      spawnTick: tick,
      phaseTick: tick,
    };
  }

  private pickType(fleet: Record<string, number> | undefined): TypeData {
    const weights = TYPE_DATA.map((d) => (fleet ? (fleet[d.type] ?? 0) : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = nextFloat(this.rng) * total;
    for (let i = 0; i < TYPE_DATA.length; i++) {
      r -= weights[i];
      if (r < 0) return TYPE_DATA[i];
    }
    return TYPE_DATA[TYPE_DATA.length - 1];
  }

  /** Runway end with the most headwind; keeps the current one until its tailwind is too strong. */
  private bestRunway(wind: Wind, current: string | null): string {
    const tail = (r: GroundRunwayEnd) => -wind.speed * Math.cos(((r.heading - wind.direction) * Math.PI) / 180);
    if (current) {
      const cur = this.airport.runways.find((r) => r.id === current);
      if (cur && tail(cur) <= MAX_TAILWIND_KT) return current;
    }
    return [...this.airport.runways].sort((a, b) => tail(a) - tail(b))[0].id;
  }

  private edgeLen(a: string, b: string): number {
    return this.graph.link(a, b)?.len ?? 0;
  }

  private edgeLimit(a: string, b: string): number {
    const kind = this.graph.link(a, b)?.edge.kind;
    switch (kind) {
      case 'stand':
        return STAND_KT;
      case 'taxilane':
      case 'link':
        return APRON_KT;
      case 'connector':
        return CONNECTOR_KT;
      default:
        return TAXI_KT;
    }
  }

  /** x, y, heading from the graph position. */
  private place(ac: GroundAircraft): void {
    if (!ac.node) return;
    const a = this.graph.node(ac.node);
    if (!ac.next) {
      ac.x = a.x;
      ac.y = a.y;
      return;
    }
    const b = this.graph.node(ac.next);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const f = Math.min(1, ac.progress / len);
    ac.x = a.x + (b.x - a.x) * f;
    ac.y = a.y + (b.y - a.y) * f;
    ac.heading = bearing(a, b);
  }

  private routeNames(route: readonly string[]): string[] {
    const names: string[] = [];
    for (let i = 1; i < route.length; i++) {
      const e = this.graph.link(route[i - 1], route[i])?.edge;
      if (!e || e.kind === 'stand') continue;
      if (names[names.length - 1] !== e.name) names.push(e.name);
    }
    return names;
  }
}

/** Speed (kt) from which the aircraft can still stop / slow to `vEnd` within `dist` metres. */
function brakeTo(vEnd: number, dist: number): number {
  if (dist <= 0) return vEnd;
  const a = TAXI_DECEL * KT; // m/s^2
  const v = Math.sqrt((vEnd * KT) ** 2 + 2 * a * dist);
  return v / KT;
}

/** "A5h" -> "A5"; stands and other nodes as they are. */
export function placeLabel(nodeId: string): string {
  return nodeId.endsWith('h') ? nodeId.slice(0, -1) : nodeId;
}

/** Replay a ground command log. */
export function groundReplay(scenario: GroundScenario, log: readonly GroundLoggedCommand[], ticks: number): GroundSimulation {
  const sim = new GroundSimulation(scenario);
  let i = 0;
  for (let t = 0; t < ticks; t++) {
    while (i < log.length && log[i].tick === t) sim.command(log[i++].command);
    sim.step();
  }
  sim.drainEvents();
  return sim;
}
