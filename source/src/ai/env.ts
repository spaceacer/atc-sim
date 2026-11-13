// Episode wrapper around the Simulation for AI controllers (no I/O; the bridge
// adds the stdio protocol). One AtcEnv = one airspace; make many for batches.
//
//   const env = new AtcEnv({ map: 'vabb', traffic: 'normal' });
//   let { obs } = env.reset(1);
//   const r = env.step({ actions: [[slot, type, param]], commands: ['IGO12 C 4'] });
//
// The agent acts every ticksPerStep ticks (default 20 = 10 s of sim time).
// Reward is the change in game score over the step, plus optional penalties.

import { Simulation, SCORE, type Command, type ScenarioOptions, type SimEvent, type Stats, type TrafficProfile, type WeatherProfile } from '../engine/index.js';
import { findMap, findTraffic, TRAFFIC_LEVELS } from '../data/scenarios.js';
import { parseCommand } from '../commands/parser.js';
import { decodeAction } from './actions.js';
import { SlotMap, encodeState, encodeVector, type StateView } from './observe.js';

export interface RewardConfig {
  /** Added for every command the simulation rejects (bad or impossible clearance). */
  rejectedCommand: number;
  /** Added for every new conflict alert (a predicted loss of separation). */
  conflictWarning: number;
}

export interface EnvConfig {
  map: string;
  /** Traffic level id ('light' | 'normal' | 'busy') or a full profile. */
  traffic: string | TrafficProfile;
  /** 'variable' (random, shifting), 'calm', or a full profile. */
  weather: 'variable' | 'calm' | WeatherProfile;
  /** Base seed; episode n uses seed + n unless reset() is given one. */
  seed: number;
  episodeMinutes: number;
  ticksPerStep: number;
  observation: 'vector' | 'state' | 'both';
  /** Include the step's events in info (handy for debugging and language agents). */
  events: boolean;
  reward: RewardConfig;
  /** Rule switches (separation minima, separate landing clearance, alert look-ahead). */
  options?: ScenarioOptions;
}

export const DEFAULT_ENV_CONFIG: EnvConfig = {
  map: 'vabb',
  traffic: 'normal',
  weather: 'variable',
  seed: 1,
  episodeMinutes: 60,
  ticksPerStep: 20,
  observation: 'vector',
  events: false,
  reward: { rejectedCommand: 0, conflictWarning: 0 },
};

export interface Observation {
  vector?: Float32Array;
  state?: StateView;
}

export interface StepResult {
  obs: Observation;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  info: StepInfo;
}

export interface StepInfo {
  tick: number;
  seed: number;
  stats: Stats;
  rejected: string[];
  events?: SimEvent[];
}

export class AtcEnv {
  readonly config: EnvConfig;
  private sim: Simulation | null = null;
  private slots = new SlotMap();
  private episode = 0;
  private seed = 0;
  private maxTicks: number;

  constructor(config: Partial<EnvConfig> = {}) {
    this.config = {
      ...DEFAULT_ENV_CONFIG,
      ...config,
      reward: { ...DEFAULT_ENV_CONFIG.reward, ...(config.reward ?? {}) },
    };
    this.maxTicks = Math.round((this.config.episodeMinutes * 60) / 0.5);
  }

  get simulation(): Simulation {
    if (!this.sim) throw new Error('call reset() first');
    return this.sim;
  }

  get airport() {
    return findMap(this.config.map).airport;
  }

  reset(seed?: number): { obs: Observation; info: StepInfo } {
    this.seed = seed ?? this.config.seed + this.episode;
    this.episode++;
    const { airport } = findMap(this.config.map);
    this.sim = new Simulation({
      seed: this.seed,
      airport,
      traffic: resolveTraffic(this.config.traffic),
      weather: resolveWeather(this.config.weather),
      ...(this.config.options ? { options: this.config.options } : {}),
    });
    this.maxTicks = Math.round((this.config.episodeMinutes * 60) / this.sim.dt);
    this.slots.reset();
    this.slots.sync(this.sim.getState().aircraft);
    return { obs: this.observe(), info: this.info([], []) };
  }

  step(input: { actions?: readonly (readonly number[])[]; commands?: readonly (string | Command)[]; ticks?: number } = {}): StepResult {
    const sim = this.simulation;
    const state = sim.getState();
    const airport = sim.scenario.airport;
    const before = state.stats.score;
    const rejected: string[] = [];
    let penalties = 0;

    const apply = (cmd: Command) => {
      const r = sim.command(cmd);
      if (!r.ok) {
        rejected.push(r.message);
        penalties += this.config.reward.rejectedCommand;
      }
    };
    for (const action of input.actions ?? []) {
      const cmd = decodeAction(action, state, airport, this.slots);
      if (cmd) apply(cmd);
    }
    for (const c of input.commands ?? []) {
      if (typeof c !== 'string') {
        apply(c);
        continue;
      }
      const parsed = parseCommand(c);
      if (!parsed.ok) {
        rejected.push(`${c}: ${parsed.error}`);
        penalties += this.config.reward.rejectedCommand;
        continue;
      }
      for (const cmd of parsed.commands) apply(cmd);
    }

    const ticks = Math.max(1, Math.round(input.ticks ?? this.config.ticksPerStep));
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks && sim.tick < this.maxTicks; i++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'conflictWarning') penalties += this.config.reward.conflictWarning;
        if (this.config.events && e.type !== 'commandAccepted') events.push(e);
      }
    }
    sim.drainEvents(); // command events from this step's commands
    this.slots.sync(state.aircraft);

    return {
      obs: this.observe(),
      reward: state.stats.score - before + penalties,
      terminated: false,
      truncated: sim.tick >= this.maxTicks,
      info: this.info(rejected, events),
    };
  }

  private observe(): Observation {
    const sim = this.simulation;
    const state = sim.getState();
    const obs: Observation = {};
    if (this.config.observation !== 'state') {
      obs.vector = encodeVector(state, sim.scenario.airport, this.slots, sim.tick / this.maxTicks);
    }
    if (this.config.observation !== 'vector') obs.state = encodeState(state, this.slots);
    return obs;
  }

  private info(rejected: string[], events: SimEvent[]): StepInfo {
    const sim = this.simulation;
    const info: StepInfo = { tick: sim.tick, seed: this.seed, stats: { ...sim.getState().stats }, rejected };
    if (this.config.events) info.events = events;
    return info;
  }
}

export function resolveTraffic(t: EnvConfig['traffic']): TrafficProfile {
  if (typeof t !== 'string') return t;
  if (!TRAFFIC_LEVELS.some((l) => l.id === t)) throw new Error(`unknown traffic level "${t}"`);
  return findTraffic(t).profile;
}

export function resolveWeather(w: EnvConfig['weather']): WeatherProfile {
  if (w === 'variable') return { variable: true };
  if (w === 'calm') return { variable: false, initialWind: { direction: 360, speed: 0 } };
  return w;
}

/** Score table, re-exported so clients can document their reward. */
export const SCORE_TABLE = SCORE;
