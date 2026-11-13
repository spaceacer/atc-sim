// Session and scenario files: plain JSON that pins down a run completely.
//
//   A scenario file is a session with no commands: map, seed, traffic, weather.
//   A saved session adds the command log and the tick it was saved at; loading
//   it replays the log to that tick, which reproduces the exact same state.
//
// The airport is referenced by map id, so files stay small and readable.

import type { LoggedCommand, Scenario, ScenarioOptions, TrafficProfile, WeatherProfile } from '../engine/types.js';
import { Simulation, replay } from '../engine/index.js';
import { MAPS, findMap } from './scenarios.js';
import { VERSION } from '../version.js';

export const SESSION_FORMAT = 'atc-sim-session';
export const SESSION_VERSION = 1;

export interface SessionFile {
  format: typeof SESSION_FORMAT;
  version: number;
  map: string;
  seed: number;
  traffic: TrafficProfile;
  weather: WeatherProfile;
  options?: ScenarioOptions;
  /** Tick the session was saved at; 0 for a fresh scenario. */
  tick: number;
  commands: LoggedCommand[];
  note?: string;
  /** Simulator version that saved the file. Replays are exact only on the same engine behaviour. */
  appVersion?: string;
}

export function sessionFromSim(sim: Simulation, mapId: string, note?: string): SessionFile {
  const { seed, traffic, weather, options } = sim.scenario;
  const file: SessionFile = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    appVersion: VERSION,
    map: mapId,
    seed,
    traffic,
    weather,
    tick: sim.tick,
    commands: [...sim.getCommandLog()],
  };
  if (options) file.options = options;
  if (note) file.note = note;
  return file;
}

export function scenarioFromSession(file: SessionFile): Scenario {
  const scenario: Scenario = {
    seed: file.seed,
    airport: findMap(file.map).airport,
    traffic: file.traffic,
    weather: file.weather,
  };
  if (file.options) scenario.options = file.options;
  return scenario;
}

/** Rebuild the simulation exactly as it was when the session was saved. */
export function restoreSession(file: SessionFile): Simulation {
  return replay(scenarioFromSession(file), file.commands, file.tick);
}

/** Parse and validate a session or scenario file. */
export function parseSession(text: string): { ok: true; file: SessionFile } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not a JSON file' };
  }
  if (!isObject(data) || data.format !== SESSION_FORMAT) {
    return { ok: false, error: `not an ATC session file (expected "format": "${SESSION_FORMAT}")` };
  }
  if (typeof data.version !== 'number' || data.version > SESSION_VERSION) {
    return { ok: false, error: `unsupported session version ${String(data.version)}` };
  }
  if (typeof data.map !== 'string' || !MAPS.some((m) => m.id === data.map)) {
    return { ok: false, error: `unknown map "${String(data.map)}" (have: ${MAPS.map((m) => m.id).join(', ')})` };
  }
  if (!Number.isInteger(data.seed)) return { ok: false, error: 'seed must be an integer' };
  if (!isTraffic(data.traffic)) return { ok: false, error: 'traffic must have arrivals and departures intervals' };
  if (!isObject(data.weather) || typeof data.weather.variable !== 'boolean') {
    return { ok: false, error: 'weather must have "variable": true or false' };
  }
  const tick = data.tick ?? 0;
  if (!Number.isInteger(tick) || (tick as number) < 0) return { ok: false, error: 'tick must be a whole number' };
  const commands = data.commands ?? [];
  if (!Array.isArray(commands) || !commands.every(isLoggedCommand)) {
    return { ok: false, error: 'commands must be a list of { tick, command }' };
  }
  return { ok: true, file: { ...(data as unknown as SessionFile), tick: tick as number, commands } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSpawn(v: unknown): boolean {
  return isObject(v) && typeof v.minIntervalSec === 'number' && typeof v.maxIntervalSec === 'number' && typeof v.firstSec === 'number';
}

function isTraffic(v: unknown): boolean {
  return isObject(v) && isSpawn(v.arrivals) && isSpawn(v.departures);
}

function isLoggedCommand(v: unknown): v is LoggedCommand {
  return (
    isObject(v) &&
    Number.isInteger(v.tick) &&
    isObject(v.command) &&
    typeof v.command.type === 'string' &&
    typeof v.command.callsign === 'string'
  );
}
