import { Simulation, type Scenario, type Wind } from '../src/engine/index.js';
import { XDEM } from '../src/data/airports/xdem.js';

const NONE = { minIntervalSec: 60, maxIntervalSec: 60, firstSec: 0, max: 0 };

/** A scenario with no random traffic and a fixed wind, for hand-placed test aircraft. */
export function emptyScenario(seed = 1, wind: Wind = { direction: 270, speed: 0 }): Scenario {
  return {
    seed,
    airport: XDEM,
    traffic: { arrivals: NONE, departures: NONE },
    weather: { initialWind: wind, variable: false },
  };
}

export function emptySim(seed = 1, wind?: Wind): Simulation {
  return new Simulation(emptyScenario(seed, wind));
}

/** Seconds -> ticks for the engine's fixed tick. */
export function ticks(seconds: number, sim: Simulation): number {
  return Math.round(seconds / sim.dt);
}
