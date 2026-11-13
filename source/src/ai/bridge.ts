// Python <-> engine bridge: newline-delimited JSON over stdin/stdout.
// One process holds any number of environments; Python starts several
// processes to use several cores.
//
// Request:  {"id": 1, "op": "step", "env": 0, "actions": [[3, 1, 26]], "commands": ["IGO12 C 4"]}
// Response: {"id": 1, "ok": true, "result": {...}}   or   {"id": 1, "ok": false, "error": "..."}
//
// ops:
//   info                          spaces, feature names, action types, maps, score table
//   make   {config}               new environment -> {env, airport}
//   reset  {env, seed?}           -> {obs, info}
//   step   {env, actions?, commands?, ticks?}  -> {obs, reward, terminated, truncated, info}
//   batch  {requests: [...]}      several requests in one round trip -> {results: [...]}
//   close  {env}                  free an environment
//   quit                          exit the process
//
// Vector observations travel as base64 little-endian float32 ("vector_b64"),
// which numpy reads with np.frombuffer(base64.b64decode(s), np.float32).
// Nothing else may write to stdout.

import { createInterface } from 'node:readline';
import { DT, SCORE } from '../engine/index.js';
import { MAPS, TRAFFIC_LEVELS } from '../data/scenarios.js';
import { AtcEnv, DEFAULT_ENV_CONFIG, type EnvConfig, type Observation, type StepResult } from './env.js';
import { ACTION_TYPES, PARAM_SIZE } from './actions.js';
import { VERSION } from '../version.js';
import {
  AIRCRAFT_FEATURES,
  AIRCRAFT_FEATURE_NAMES,
  GLOBAL_FEATURES,
  GLOBAL_FEATURE_NAMES,
  MAX_AIRCRAFT,
  MAX_RUNWAYS,
  OBS_SIZE,
} from './observe.js';

export const PROTOCOL_VERSION = 1;

type Request = { id?: unknown; op?: unknown; [k: string]: unknown };

const envs = new Map<number, AtcEnv>();
let nextEnv = 0;

function wireObs(obs: Observation): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obs.vector) out.vector_b64 = Buffer.from(obs.vector.buffer, obs.vector.byteOffset, obs.vector.byteLength).toString('base64');
  if (obs.state) out.state = obs.state;
  return out;
}

function getEnv(req: Request): AtcEnv {
  const env = envs.get(Number(req.env));
  if (!env) throw new Error(`no environment ${String(req.env)} (call make first)`);
  return env;
}

function handle(req: Request): unknown {
  switch (req.op) {
    case 'info':
      return {
        protocol: PROTOCOL_VERSION,
        version: VERSION,
        dt: DT,
        obsSize: OBS_SIZE,
        maxAircraft: MAX_AIRCRAFT,
        maxRunways: MAX_RUNWAYS,
        aircraftFeatures: AIRCRAFT_FEATURES,
        globalFeatures: GLOBAL_FEATURES,
        aircraftFeatureNames: AIRCRAFT_FEATURE_NAMES,
        globalFeatureNames: GLOBAL_FEATURE_NAMES,
        actionTypes: ACTION_TYPES,
        paramSize: PARAM_SIZE,
        maps: MAPS.map((m) => ({ id: m.id, label: m.label })),
        trafficLevels: TRAFFIC_LEVELS.map((t) => t.id),
        score: SCORE,
        defaultConfig: DEFAULT_ENV_CONFIG,
      };
    case 'make': {
      const env = new AtcEnv((req.config ?? {}) as Partial<EnvConfig>);
      const id = nextEnv++;
      envs.set(id, env);
      return { env: id, config: env.config, airport: env.airport };
    }
    case 'reset': {
      const seed = req.seed === undefined || req.seed === null ? undefined : Number(req.seed);
      const r = getEnv(req).reset(seed);
      return { obs: wireObs(r.obs), info: r.info };
    }
    case 'step': {
      const r: StepResult = getEnv(req).step({
        actions: (req.actions ?? []) as number[][],
        commands: (req.commands ?? []) as string[],
        ticks: req.ticks === undefined ? undefined : Number(req.ticks),
      });
      return { obs: wireObs(r.obs), reward: r.reward, terminated: r.terminated, truncated: r.truncated, info: r.info };
    }
    case 'batch': {
      const list = Array.isArray(req.requests) ? (req.requests as Request[]) : [];
      return {
        results: list.map((r) => {
          try {
            return { ok: true, result: handle(r) };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      };
    }
    case 'close':
      envs.delete(Number(req.env));
      return { closed: true };
    default:
      throw new Error(`unknown op "${String(req.op)}"`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req: Request;
  try {
    req = JSON.parse(line) as Request;
  } catch {
    process.stdout.write(JSON.stringify({ id: null, ok: false, error: 'invalid JSON' }) + '\n');
    return;
  }
  if (req.op === 'quit') {
    process.stdout.write(JSON.stringify({ id: req.id ?? null, ok: true, result: { bye: true } }) + '\n', () => process.exit(0));
    return;
  }
  let out: string;
  try {
    out = JSON.stringify({ id: req.id ?? null, ok: true, result: handle(req) });
  } catch (e) {
    out = JSON.stringify({ id: req.id ?? null, ok: false, error: (e as Error).message });
  }
  process.stdout.write(out + '\n');
});
rl.on('close', () => process.exit(0));
