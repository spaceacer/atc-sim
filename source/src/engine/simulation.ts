// The simulation engine. Pure TypeScript: no DOM, no timers, no wall clock.
//
//   const sim = new Simulation(scenario);
//   sim.command({ type: 'heading', callsign: 'AIC12', heading: 270 });
//   sim.step();                    // advances exactly DT seconds of sim time
//   const state = sim.getState();  // plain data (treat as read-only)
//   const events = sim.drainEvents();
//
// Determinism: same scenario (seed) + same commands applied at the same ticks
// => identical state, within one JavaScript runtime version.

import type {
  Aircraft,
  Command,
  CommandResult,
  LoggedCommand,
  RunwayEnd,
  Scenario,
  SimEvent,
  SimState,
} from './types.js';
import { CATEGORY_TYPE, performanceOf, takeoffRunNeeded } from './aircraft/performance.js';
import { departureWakeSec } from './rules/wake.js';
import { integrate } from './aircraft/flight.js';
import {
  LANDING_CLEARANCE_NM,
  checkLandingClearance,
  checkThreshold,
  startMissedApproach,
  updateApproachGuidance,
} from './airspace/approach.js';
import {
  blockingStrips,
  findFix,
  findRunway,
  insideBoundary,
  runwaysInUse,
  stripId,
  tailwind,
} from './airspace/airport.js';
import { updateDirectGuidance } from './airspace/navigation.js';
import { startHold, updateHoldGuidance } from './airspace/holding.js';
import { LOOKAHEAD_SEC, predictConflicts } from './rules/prediction.js';
import { checkSeparation, DEFAULT_MINIMA } from './rules/separation.js';
import { SCORE } from './rules/scoring.js';
import {
  DEPARTURE_TURN_HEIGHT,
  createSpawner,
  trySpawnArrival,
  trySpawnDeparture,
  type SpawnerState,
} from './traffic/spawner.js';
import { initialWind, updateWind, WIND_UPDATE_SEC } from './weather.js';
import { createRng, type RngState } from './rng.js';
import { distance, normHeading } from './geometry.js';

/** Seconds of simulated time per tick. */
export const DT = 0.5;

/** Aircraft this far outside the boundary have left the airspace, nm. */
const EXIT_MARGIN_NM = 0.5;
/** A departure leaving within this distance of its exit fix counts as on track, nm. */
export const EXIT_FIX_TOLERANCE_NM = 5;
/** A departure may line up behind same-runway traffic this far beyond its line-up point, nm (600 m). */
const LINEUP_BEHIND_NM = 600 / 1852;
/** Conflict prediction runs every this many ticks (2 s). */
const PREDICT_EVERY_TICKS = 4;
/** Salt for the weather PRNG stream, so weather never shifts traffic. */
const WEATHER_SALT = 0x9e3779b9;

export class Simulation {
  readonly scenario: Scenario;
  readonly dt = DT;

  private state: SimState;
  private rng: RngState;
  private weatherRng: RngState;
  private spawner: SpawnerState;
  private events: SimEvent[] = [];
  private conflictPairs = new Set<string>();
  private warningPairs = new Set<string>();
  private nextId = 1;
  private log: LoggedCommand[] = [];
  /** Last takeoff per runway strip, for wake turbulence spacing. Rebuilt exactly on replay. */
  private lastTakeoff = new Map<string, { tick: number; callsign: string; type: string; category: Aircraft['category'] }>();
  /** Runway end id -> its strip id and the strips that share concrete with it (static per airport). */
  private readonly strips = new Map<string, { strip: string; blocking: string[] }>();

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    for (const end of scenario.airport.runways) {
      this.strips.set(end.id, { strip: stripId(end), blocking: blockingStrips(scenario.airport, end) });
    }
    this.rng = createRng(scenario.seed);
    this.weatherRng = createRng((scenario.seed ^ WEATHER_SALT) >>> 0);
    this.spawner = createSpawner(scenario.traffic.arrivals, scenario.traffic.departures, DT);
    const wind = initialWind(scenario.weather, this.weatherRng);
    this.state = {
      tick: 0,
      time: 0,
      aircraft: [],
      wind,
      runwaysInUse: runwaysInUse(scenario.airport, wind),
      runwayBusyUntil: {},
      stats: {
        score: 0,
        arrivalsSpawned: 0,
        departuresSpawned: 0,
        landed: 0,
        departed: 0,
        wrongExits: 0,
        separationLosses: 0,
        conflictWarnings: 0,
        missedApproaches: 0,
        leftAirspace: 0,
        commandsIssued: 0,
      },
    };
  }

  get tick(): number {
    return this.state.tick;
  }

  /** Current state. Live object for speed: callers must not mutate it. */
  getState(): SimState {
    return this.state;
  }

  /** Events since the last drain, oldest first. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Every command applied so far, with the tick it applied before. */
  getCommandLog(): readonly LoggedCommand[] {
    return this.log;
  }

  /** Advance the simulation by one tick (DT seconds). */
  step(): void {
    const { airport } = this.scenario;
    const s = this.state;
    const tick = s.tick;

    // 0. Weather.
    if (this.scenario.weather.variable && tick > 0 && tick % Math.round(WIND_UPDATE_SEC / DT) === 0) {
      updateWind(s.wind, this.weatherRng, this.scenario.weather.strength);
      const inUse = runwaysInUse(airport, s.wind, s.runwaysInUse);
      if (inUse.join() !== s.runwaysInUse.join()) {
        s.runwaysInUse = inUse;
        this.events.push({ type: 'runwaysChanged', tick, inUse });
      }
    }

    // 1. Ground roll, guidance, kinematics.
    for (const ac of s.aircraft) {
      const perf = performanceOf(ac);
      if (ac.status === 'rolling') {
        this.takeoffRoll(ac, tick);
        continue;
      }
      if (ac.status === 'rollout') {
        this.landingRollout(ac, tick);
        continue;
      }
      if (ac.status !== 'airborne') continue;
      const outcome = updateApproachGuidance(ac, airport, perf);
      if (outcome.kind === 'captured') {
        this.events.push({ type: 'localizerCaptured', tick, callsign: ac.callsign, runway: outcome.runway });
      }
      updateDirectGuidance(ac, airport);
      updateHoldGuidance(ac, DT);
      integrate(ac, perf, DT);
    }

    // 2. Landing, missed approach, leaving the airspace.
    for (const ac of s.aircraft) {
      if (ac.status !== 'airborne') continue;
      const outcome = checkThreshold(ac, airport, this.landingClearanceNm());
      if (outcome.kind === 'landed') {
        const runway = findRunway(airport, outcome.runway);
        const blocker = runway ? this.runwayBlocker(runway, ac) : null;
        if (runway && blocker) {
          this.missedApproach(ac, runway, `runway occupied by ${blocker}`, tick);
        } else if (runway) {
          // Touchdown: roll out along the runway, occupying it until stopped.
          ac.status = 'rollout';
          ac.altitude = airport.elevation;
          ac.targetAltitude = airport.elevation;
          ac.heading = runway.heading;
          ac.targetHeading = runway.heading;
          ac.lateralMode = 'heading';
          ac.speed = Math.min(ac.speed, performanceOf(ac).touchdownSpeed);
          ac.targetSpeed = 0;
          this.events.push({ type: 'touchdown', tick, callsign: ac.callsign, runway: runway.id });
        }
      } else if (outcome.kind === 'missed') {
        const runway = findRunway(airport, outcome.runway);
        if (runway) this.missedApproach(ac, runway, outcome.reason, tick);
      } else if (!insideBoundary(airport.boundary, ac.x, ac.y, EXIT_MARGIN_NM)) {
        this.leaveAirspace(ac, tick);
      }
    }
    if (s.aircraft.some((a) => a.status === 'landed' || a.status === 'exited')) {
      s.aircraft = s.aircraft.filter((a) => a.status !== 'landed' && a.status !== 'exited');
    }

    // 3. Separation (airborne only).
    const minima = this.scenario.options?.separation ?? DEFAULT_MINIMA;
    for (const loss of checkSeparation(s.aircraft, this.conflictPairs, airport.elevation, minima)) {
      s.stats.separationLosses++;
      s.stats.score += SCORE.separationLoss;
      this.events.push({
        type: 'separationLoss',
        tick,
        a: loss.a.callsign,
        b: loss.b.callsign,
        distance: loss.distance,
        verticalFt: loss.verticalFt,
      });
    }

    // 3b. Conflict prediction (warnings only).
    const lookahead = this.scenario.options?.conflictLookaheadSec ?? LOOKAHEAD_SEC;
    if (lookahead > 0 && tick % PREDICT_EVERY_TICKS === 0) {
      for (const w of predictConflicts(s.aircraft, this.warningPairs, airport.elevation, minima, lookahead)) {
        s.stats.conflictWarnings++;
        this.events.push({ type: 'conflictWarning', tick, a: w.a.callsign, b: w.b.callsign, inSeconds: w.inSeconds });
      }
    }

    // 4. New traffic.
    const { traffic } = this.scenario;
    const arrival = trySpawnArrival(this.spawner, this.rng, traffic.arrivals, airport, s.aircraft, tick, DT, this.nextId, traffic.mix);
    if (arrival) {
      this.nextId++;
      s.aircraft.push(arrival.aircraft);
      s.stats.arrivalsSpawned++;
      this.events.push({ type: 'spawned', tick, callsign: arrival.aircraft.callsign, isArrival: true, where: arrival.where });
    }
    const departure = trySpawnDeparture(
      this.spawner,
      this.rng,
      traffic.departures,
      airport,
      s.aircraft,
      s.runwaysInUse,
      tick,
      DT,
      this.nextId,
      traffic.mix,
    );
    if (departure) {
      this.nextId++;
      s.aircraft.push(departure.aircraft);
      s.stats.departuresSpawned++;
      this.events.push({ type: 'spawned', tick, callsign: departure.aircraft.callsign, isArrival: false, where: departure.where });
    }

    s.tick = tick + 1;
    s.time = s.tick * DT;
  }

  /** Run n ticks with no commands. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * Apply an ATC command now (before the next tick). Logged with the current
   * tick so the session can be replayed exactly.
   */
  command(cmd: Command): CommandResult {
    const result = this.applyCommand(cmd);
    const tick = this.state.tick;
    if (result.ok) {
      this.log.push({ tick, command: cmd });
      this.state.stats.commandsIssued++;
      this.events.push({ type: 'commandAccepted', tick, callsign: cmd.callsign, message: result.message });
    } else {
      this.events.push({ type: 'commandRejected', tick, callsign: cmd.callsign, message: result.message });
    }
    return result;
  }

  /** Add an aircraft directly (scenario setup and tests). Not logged. */
  addAircraft(spec: Partial<Aircraft> & Pick<Aircraft, 'callsign' | 'x' | 'y' | 'altitude' | 'heading'>): Aircraft {
    const category = spec.category ?? 'medium';
    const speed = spec.speed ?? 250;
    const ac: Aircraft = {
      id: this.nextId++,
      type: CATEGORY_TYPE[category],
      category,
      isArrival: true,
      status: 'airborne',
      speed,
      targetHeading: spec.heading,
      turnDirection: null,
      targetAltitude: spec.altitude,
      targetSpeed: speed,
      expedite: false,
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
      spawnTick: this.state.tick,
      ...spec,
    };
    this.state.aircraft.push(ac);
    return ac;
  }

  // -------------------------------------------------------------------------
  // Tick helpers

  /** Separate landing clearance distance, or null when I/L both land by themselves (the default). */
  private landingClearanceNm(): number | null {
    const o = this.scenario.options;
    return o?.requireLandingClearance ? (o.landingClearanceNm ?? LANDING_CLEARANCE_NM) : null;
  }

  /** Decelerate along the runway; at 0 kt the landing is complete and the aircraft leaves the runway. */
  private landingRollout(ac: Aircraft, tick: number): void {
    const perf = performanceOf(ac);
    const before = ac.speed;
    ac.speed = Math.max(0, ac.speed - perf.rolloutDecel * DT);
    const distNm = (((before + ac.speed) / 2) / 3600) * DT;
    const h = (ac.heading * Math.PI) / 180;
    ac.x += Math.sin(h) * distNm;
    ac.y += Math.cos(h) * distNm;
    if (ac.speed > 0) return;
    const s = this.state;
    ac.status = 'landed';
    s.stats.landed++;
    s.stats.score += SCORE.landed;
    this.events.push({ type: 'landed', tick, callsign: ac.callsign, runway: ac.runway ?? '' });
  }

  private takeoffRoll(ac: Aircraft, tick: number): void {
    const perf = performanceOf(ac);
    ac.speed = Math.min(perf.rotateSpeed, ac.speed + perf.takeoffAccel * DT);
    const distNm = (ac.speed / 3600) * DT;
    const h = (ac.heading * Math.PI) / 180;
    ac.x += Math.sin(h) * distNm;
    ac.y += Math.cos(h) * distNm;
    if (ac.speed >= perf.rotateSpeed) {
      ac.status = 'airborne';
      ac.turnAltitude = this.scenario.airport.elevation + DEPARTURE_TURN_HEIGHT;
      ac.targetSpeed = Math.max(ac.targetSpeed, perf.minSpeed);
      this.events.push({ type: 'tookOff', tick, callsign: ac.callsign, runway: ac.runway ?? '' });
      ac.runway = null;
    }
  }

  /** Put the aircraft on the runway, at the threshold or `offsetNm` down it (an intersection). */
  private moveToRunway(ac: Aircraft, runwayId: string, offsetNm = 0): void {
    const { airport } = this.scenario;
    const runway = findRunway(airport, runwayId);
    if (!runway) return;
    const old = ac.runway ? findRunway(airport, ac.runway) : undefined;
    if (!old || ac.targetHeading === old.heading) ac.targetHeading = runway.heading;
    const h = (runway.heading * Math.PI) / 180;
    ac.runway = runway.id;
    ac.x = runway.thresholdX + Math.sin(h) * offsetNm;
    ac.y = runway.thresholdY + Math.cos(h) * offsetNm;
    ac.heading = runway.heading;
  }

  /** Runway length from threshold to the far end, m. */
  private runwayLengthM(runway: RunwayEnd): number {
    const opp = findRunway(this.scenario.airport, runway.oppositeId);
    return opp ? distance(runway.thresholdX, runway.thresholdY, opp.thresholdX, opp.thresholdY) * 1852 : 3000;
  }

  /** Seconds this departure must still wait for wake turbulence, and behind whom. */
  private wakeWait(ac: Aircraft, runway: RunwayEnd, fromIntersection: boolean): { sec: number; leader: string } {
    let worst = { sec: 0, leader: '' };
    for (const strip of this.strips.get(runway.id)?.blocking ?? []) {
      const last = this.lastTakeoff.get(strip);
      if (!last || last.callsign === ac.callsign) continue;
      const need = departureWakeSec(last.category, ac.category, fromIntersection);
      const left = Math.ceil(need - (this.state.tick - last.tick) * DT);
      if (left > worst.sec) worst = { sec: left, leader: `${last.callsign} (${last.type})` };
    }
    return worst;
  }

  private missedApproach(ac: Aircraft, runway: RunwayEnd, reason: string, tick: number): void {
    startMissedApproach(ac, this.scenario.airport, runway.heading);
    const s = this.state;
    s.stats.missedApproaches++;
    s.stats.score += SCORE.missedApproach;
    this.events.push({ type: 'missedApproach', tick, callsign: ac.callsign, runway: runway.id, reason });
  }

  private leaveAirspace(ac: Aircraft, tick: number): void {
    const s = this.state;
    ac.status = 'exited';
    if (ac.isArrival || !ac.exitFix) {
      s.stats.leftAirspace++;
      s.stats.score += SCORE.leftAirspace;
      this.events.push({ type: 'leftAirspace', tick, callsign: ac.callsign });
      return;
    }
    const fix = findFix(this.scenario.airport, ac.exitFix);
    const near = fix !== undefined && distance(ac.x, ac.y, fix.x, fix.y) <= EXIT_FIX_TOLERANCE_NM;
    const high = ac.altitude >= ac.exitAltitude - 50;
    if (near && high) {
      s.stats.departed++;
      s.stats.score += SCORE.departed;
      this.events.push({ type: 'departed', tick, callsign: ac.callsign, fix: ac.exitFix });
      return;
    }
    const reason = !near
      ? `left the airspace away from ${ac.exitFix}`
      : `left via ${ac.exitFix} at ${fmtAlt(ac.altitude)}, needed ${fmtAlt(ac.exitAltitude)}`;
    s.stats.wrongExits++;
    s.stats.score += SCORE.wrongExit;
    this.events.push({ type: 'wrongExit', tick, callsign: ac.callsign, reason });
  }

  /** Callsign of whatever occupies this runway (or one crossing it), or null if clear. */
  /**
   * Callsign of whatever occupies this runway (or one crossing it), or null if clear.
   * With `lineUpAtNm` (a line-up `lineUpAtNm` down the runway): traffic on the same
   * runway end already LINEUP_BEHIND_NM or more beyond that point and moving away
   * (landing aircraft slowing down, a departure rolling) does not stop a line-up.
   */
  private runwayBlocker(runway: RunwayEnd, self: Aircraft, lineUpAtNm: number | null = null): string | null {
    const s = this.state;
    const strips = this.strips.get(runway.id)?.blocking ?? [];
    const h = (runway.heading * Math.PI) / 180;
    for (const other of s.aircraft) {
      if (other === self || other.runway === null) continue;
      if (other.status !== 'lineup' && other.status !== 'rolling' && other.status !== 'rollout') continue;
      const strip = this.strips.get(other.runway)?.strip;
      if (strip === undefined || !strips.includes(strip)) continue;
      if (lineUpAtNm !== null && other.runway === runway.id && other.status !== 'lineup') {
        const along = (other.x - runway.thresholdX) * Math.sin(h) + (other.y - runway.thresholdY) * Math.cos(h);
        if (along >= lineUpAtNm + LINEUP_BEHIND_NM) continue; // well down the runway, moving away
      }
      return other.callsign;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Commands

  private applyCommand(cmd: Command): CommandResult {
    const ac = this.state.aircraft.find((a) => a.callsign === cmd.callsign);
    if (!ac) return { ok: false, message: `${cmd.callsign}: no such aircraft` };
    const perf = performanceOf(ac);
    const { airport } = this.scenario;
    const onGround = ac.status !== 'airborne';
    const after = onGround ? ' after departure' : '';

    switch (cmd.type) {
      case 'heading': {
        const h = cmd.heading;
        if (!Number.isFinite(h) || h < 0 || h > 360) {
          return { ok: false, message: `${ac.callsign}: invalid heading ${h}` };
        }
        const cancelled = this.cancelApproach(ac);
        ac.lateralMode = 'heading';
        ac.route = [];
        ac.hold = null;
        ac.targetHeading = normHeading(h);
        ac.turnDirection = cmd.turn ?? null;
        const turn = cmd.turn === 'L' ? 'left ' : cmd.turn === 'R' ? 'right ' : '';
        return {
          ok: true,
          message: `${ac.callsign} turn ${turn}heading ${fmt3(ac.targetHeading)}${after}${cancelled ? ', approach cancelled' : ''}`,
        };
      }
      case 'altitude': {
        const alt = cmd.altitude;
        if (!Number.isFinite(alt) || alt < 1000 || alt > perf.maxAltitude) {
          return { ok: false, message: `${ac.callsign}: altitude must be 1,000 to ${perf.maxAltitude.toLocaleString('en-US')} ft` };
        }
        const cancelled = ac.lateralMode === 'localizer' ? this.cancelApproach(ac) : false;
        ac.targetAltitude = alt;
        ac.expedite = cmd.expedite === true && alt !== ac.altitude;
        const verb = onGround ? 'climb' : alt > ac.altitude ? 'climb' : alt < ac.altitude ? 'descend' : 'maintain';
        return {
          ok: true,
          message: `${ac.callsign} ${verb} ${fmtAlt(alt)}${after}${ac.expedite ? ', expedite' : ''}${cancelled ? ', approach cancelled' : ''}`,
        };
      }
      case 'speed': {
        const spd = cmd.speed;
        const min = ac.lateralMode === 'localizer' ? perf.approachSpeed : perf.minSpeed;
        if (!Number.isFinite(spd) || spd < min || spd > perf.maxSpeed) {
          return { ok: false, message: `${ac.callsign}: speed must be ${min} to ${perf.maxSpeed} kt (${ac.type})` };
        }
        ac.targetSpeed = spd;
        return { ok: true, message: `${ac.callsign} speed ${spd} kt${after}` };
      }
      case 'direct': {
        if (cmd.fixes.length === 0) return { ok: false, message: `${ac.callsign}: no fix given` };
        const unknown = cmd.fixes.filter((f) => !findFix(airport, f));
        if (unknown.length > 0) return { ok: false, message: `${ac.callsign}: unknown fix ${unknown.join(', ')}` };
        const cancelled = this.cancelApproach(ac);
        ac.lateralMode = 'direct';
        ac.hold = null;
        ac.route = cmd.fixes.map((f) => f.toUpperCase());
        ac.turnDirection = null;
        return {
          ok: true,
          message: `${ac.callsign} direct ${ac.route.join(' ')}${after}${cancelled ? ', approach cancelled' : ''}`,
        };
      }
      case 'land':
      case 'intercept': {
        if (!ac.isArrival) return { ok: false, message: `${ac.callsign} is a departure, not landing here` };
        // Unless the scenario requires a separate landing clearance, I lands by itself just like L.
        const separate = this.landingClearanceNm() !== null;
        const landing = cmd.type === 'land' || !separate;
        const want = findRunway(airport, cmd.runway)?.id ?? cmd.runway.toUpperCase();
        const onApproach = (ac.lateralMode === 'approach' || ac.lateralMode === 'localizer') && ac.runway === want;
        if (onApproach) {
          // Already cleared for this approach: only the landing clearance can be added.
          if (cmd.type === 'intercept') return { ok: false, message: `${ac.callsign} is already cleared for the approach to runway ${want}` };
          if (ac.landingCleared) return { ok: false, message: `${ac.callsign} is already cleared to land runway ${want}` };
          if (!this.state.runwaysInUse.includes(want)) {
            return { ok: false, message: `${ac.callsign} unable to land: runway ${want} not in use` };
          }
          ac.landingCleared = true;
          return { ok: true, message: `${ac.callsign} runway ${want}, cleared to land` };
        }
        const check = checkLandingClearance(ac, airport, cmd.runway, this.state.wind, this.state.runwaysInUse);
        if (!check.ok) {
          return { ok: false, message: `${ac.callsign} unable ${cmd.type === 'land' ? 'to land' : 'to intercept'}: ${check.reason}` };
        }
        ac.lateralMode = 'approach';
        ac.route = [];
        ac.hold = null;
        ac.runway = check.runway.id;
        ac.landingCleared = landing;
        ac.lastCrossTrack = null;
        if (check.runway.ils === false) {
          // No ILS: a visual approach; the pilot lines up with the runway himself.
          return {
            ok: true,
            message: landing
              ? `${ac.callsign} cleared visual approach and to land runway ${check.runway.id}`
              : `${ac.callsign} cleared visual approach runway ${check.runway.id}`,
          };
        }
        return {
          ok: true,
          message:
            cmd.type === 'land'
              ? `${ac.callsign} cleared to land runway ${check.runway.id}`
              : landing
                ? `${ac.callsign} cleared to intercept and land runway ${check.runway.id}`
                : `${ac.callsign} cleared to intercept, ILS runway ${check.runway.id}`,
        };
      }
      case 'hold': {
        if (ac.status !== 'airborne') return { ok: false, message: `${ac.callsign} is not airborne` };
        let point = { x: ac.x, y: ac.y };
        let fixName: string | null = null;
        if (cmd.fix) {
          const fix = findFix(airport, cmd.fix);
          if (!fix) return { ok: false, message: `${ac.callsign}: unknown fix ${cmd.fix}` };
          point = fix;
          fixName = fix.name;
        }
        const cancelled = this.cancelApproach(ac);
        const turn = cmd.turn ?? 'R';
        const hold = startHold(ac, point, fixName, turn);
        const where = fixName ? `at ${fixName}` : 'present position';
        return {
          ok: true,
          message: `${ac.callsign} hold ${where}, inbound ${fmt3(hold.inbound)}, ${turn === 'L' ? 'left' : 'right'} turns${cancelled ? ', approach cancelled' : ''}`,
        };
      }
      case 'goAround': {
        if (ac.lateralMode === 'localizer' && ac.runway) {
          const runway = findRunway(airport, ac.runway);
          if (runway) this.missedApproach(ac, runway, 'instructed by ATC', this.state.tick);
          return { ok: true, message: `${ac.callsign} go around, fly runway heading, climb 3,000 ft` };
        }
        if (ac.lateralMode === 'approach') {
          this.cancelApproach(ac);
          return { ok: true, message: `${ac.callsign} approach clearance cancelled, continue heading ${fmt3(ac.heading)}` };
        }
        return { ok: false, message: `${ac.callsign} is not on approach` };
      }
      case 'lineUp':
      case 'takeoff': {
        const lineUpOnly = cmd.type === 'lineUp';
        if (ac.status === 'rolling' || ac.status === 'airborne') {
          return { ok: false, message: `${ac.callsign} is already ${ac.status === 'rolling' ? 'rolling' : 'airborne'}` };
        }
        if (lineUpOnly && ac.status === 'lineup') return { ok: false, message: `${ac.callsign} is already lined up` };
        const wanted = cmd.runway ?? ac.runway ?? '';
        const runway = findRunway(airport, wanted);
        if (!runway) {
          const ids = airport.runways.map((r) => r.id).join(', ');
          return { ok: false, message: `${ac.callsign}: unknown runway ${wanted} (available: ${ids})` };
        }
        if (ac.status === 'lineup' && runway.id !== ac.runway) {
          return { ok: false, message: `${ac.callsign} is lined up on ${ac.runway}, cannot change runway` };
        }
        const tw = tailwind(runway, this.state.wind);
        if (!this.state.runwaysInUse.includes(runway.id)) {
          return { ok: false, message: `${ac.callsign} unable: runway ${runway.id} not in use, tailwind ${Math.round(tw)} kt` };
        }
        // Intersection: given now, or kept from the line-up.
        const wantedInt = cmd.intersection?.toUpperCase() ?? (ac.status === 'lineup' ? ac.fromIntersection : null);
        if (ac.status === 'lineup' && cmd.intersection && wantedInt !== ac.fromIntersection) {
          return { ok: false, message: `${ac.callsign} is lined up ${ac.fromIntersection ? `at ${ac.fromIntersection}` : 'at the threshold'}` };
        }
        const intersection = wantedInt ? runway.intersections?.find((i) => i.name === wantedInt) : undefined;
        if (wantedInt && !intersection) {
          const names = (runway.intersections ?? []).map((i) => i.name).join(', ') || 'none';
          return { ok: false, message: `${ac.callsign}: no intersection ${wantedInt} on runway ${runway.id} (available: ${names})` };
        }
        const lengthM = this.runwayLengthM(runway);
        const available = intersection ? intersection.remainingM : lengthM;
        const needed = takeoffRunNeeded(ac);
        if (needed > available) {
          return {
            ok: false,
            message: `${ac.callsign} unable: ${intersection ? `${intersection.name} leaves` : `runway ${runway.id} has`} ${fmtM(available)}, ${ac.type} needs ${fmtM(needed)}`,
          };
        }
        const where = intersection ? ` at ${intersection.name}` : '';
        // Line up behind landing (or departing) traffic once it is well down the runway;
        // takeoff only with the runway clear.
        const offsetNm = intersection ? Math.max(0, lengthM - intersection.remainingM) / 1852 : 0;
        const blocker = this.runwayBlocker(runway, ac, lineUpOnly ? offsetNm : null);
        if (blocker) {
          return { ok: false, message: `${ac.callsign} unable${lineUpOnly ? ' to line up' : ''}: runway ${runway.id} occupied by ${blocker}` };
        }
        if (!lineUpOnly) {
          const wake = this.wakeWait(ac, runway, intersection !== undefined);
          if (wake.sec > 0) {
            return { ok: false, message: `${ac.callsign} unable: wake turbulence behind ${wake.leader}, ${wake.sec} s to wait` };
          }
        }

        // Taxi to another runway instantly (no ground movement model yet).
        if (ac.status !== 'lineup') {
          this.moveToRunway(ac, runway.id, offsetNm);
          ac.fromIntersection = intersection?.name ?? null;
        }
        if (lineUpOnly) {
          ac.status = 'lineup';
          return { ok: true, message: `${ac.callsign}${where ? ` via${where},` : ''} line up and wait runway ${runway.id}` };
        }
        ac.status = 'rolling';
        ac.speed = 0;
        const strip = this.strips.get(runway.id)?.strip ?? stripId(runway);
        this.lastTakeoff.set(strip, { tick: this.state.tick, callsign: ac.callsign, type: ac.type, category: ac.category });
        return { ok: true, message: `${ac.callsign}${where ? ` from${where},` : ''} cleared for takeoff runway ${runway.id}` };
      }
    }
  }

  /** Leave approach mode; level off where the aircraft is. Returns true if an approach was cancelled. */
  private cancelApproach(ac: Aircraft): boolean {
    if (ac.lateralMode !== 'approach' && ac.lateralMode !== 'localizer') return false;
    const wasEstablished = ac.lateralMode === 'localizer';
    ac.lateralMode = 'heading';
    ac.runway = null;
    ac.landingCleared = false;
    ac.lastCrossTrack = null;
    ac.targetHeading = ac.heading;
    if (wasEstablished) ac.targetAltitude = Math.max(1000, Math.round(ac.altitude / 100) * 100);
    return true;
  }
}

/** Replay a command log against a scenario; returns the simulation after `ticks`. */
export function replay(scenario: Scenario, log: readonly LoggedCommand[], ticks: number): Simulation {
  const sim = new Simulation(scenario);
  let i = 0;
  for (let t = 0; t < ticks; t++) {
    while (i < log.length && log[i].tick === t) sim.command(log[i++].command);
    sim.step();
  }
  sim.drainEvents();
  return sim;
}

function fmt3(h: number): string {
  return String(Math.round(h)).padStart(3, '0');
}

function fmtM(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

function fmtAlt(alt: number): string {
  return `${Math.round(alt).toLocaleString('en-US')} ft`;
}
