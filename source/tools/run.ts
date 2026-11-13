// Headless batch runner and benchmark.
//
//   npm run sim                         # 100 seeds x 60 min at Mumbai, no controller
//   npm run sim -- --seeds 1000 --minutes 60 --map xdem
//   npm run sim -- --auto               # with the naive demo controller
//
// Prints aggregate stats and engine throughput (ticks per second).

import { Simulation, stateHash } from '../src/engine/index.js';
import { findMap, makeScenario } from '../src/data/scenarios.js';
import { naiveCommands } from './naiveController.js';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const seeds = arg('seeds', 100);
const minutes = arg('minutes', 60);
const auto = process.argv.includes('--auto');
const mapArg = process.argv.indexOf('--map');
const map = findMap(mapArg >= 0 ? process.argv[mapArg + 1] : undefined);
const CONTROL_EVERY_SEC = 10;

const totals = { arrivals: 0, departures: 0, landed: 0, departed: 0, wrong: 0, losses: 0, missed: 0, left: 0, score: 0 };
let totalTicks = 0;
let lastHash = '';
const start = performance.now();

for (let seed = 1; seed <= seeds; seed++) {
  const sim = new Simulation(makeScenario(seed, map.id));
  const ticks = Math.round((minutes * 60) / sim.dt);
  const controlEvery = Math.round(CONTROL_EVERY_SEC / sim.dt);
  for (let t = 0; t < ticks; t++) {
    if (auto && t % controlEvery === 0) {
      for (const cmd of naiveCommands(sim.getState(), map.airport)) sim.command(cmd);
    }
    sim.step();
    sim.drainEvents();
  }
  const s = sim.getState().stats;
  totals.arrivals += s.arrivalsSpawned;
  totals.departures += s.departuresSpawned;
  totals.landed += s.landed;
  totals.departed += s.departed;
  totals.wrong += s.wrongExits;
  totals.losses += s.separationLosses;
  totals.missed += s.missedApproaches;
  totals.left += s.leftAirspace;
  totals.score += s.score;
  totalTicks += ticks;
  lastHash = stateHash(sim.getState());
}

const elapsedMs = performance.now() - start;
const simHours = (seeds * minutes) / 60;
console.log(`Runs: ${map.label}, ${seeds} seeds x ${minutes} min${auto ? ' (naive controller)' : ' (no controller)'}`);
console.log(`Arrivals: ${totals.arrivals}  landed: ${totals.landed}   Departures: ${totals.departures}  departed: ${totals.departed}  wrong exit: ${totals.wrong}`);
console.log(`Separation losses: ${totals.losses}`);
console.log(`Missed approaches: ${totals.missed}  left airspace: ${totals.left}  mean score: ${(totals.score / seeds).toFixed(1)}`);
console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(2)} s for ${simHours.toFixed(1)} simulated hours`);
console.log(`Throughput: ${Math.round(totalTicks / (elapsedMs / 1000)).toLocaleString('en-US')} ticks/s, ` +
  `${Math.round(simHours / (elapsedMs / 3_600_000)).toLocaleString('en-US')} sim hours per wall hour (1 core)`);
console.log(`Final state hash of last run: ${lastHash}`);
