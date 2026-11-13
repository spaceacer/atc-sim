import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, replay, stateHash, type Command } from '../src/engine/index.js';
import { makeScenario } from '../src/data/scenarios.js';

const ONE_HOUR = 7200; // ticks at 0.5 s

/** Run an hour of traffic, issuing a scripted command to each new arrival. */
function scriptedRun(seed: number): Simulation {
  const sim = new Simulation(makeScenario(seed));
  for (let t = 0; t < ONE_HOUR; t++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'spawned') {
        const cmds: Command[] = [
          { type: 'altitude', callsign: e.callsign, altitude: 4000 },
          { type: 'speed', callsign: e.callsign, speed: 210 },
        ];
        for (const c of cmds) sim.command(c);
      }
    }
  }
  return sim;
}

test('same seed + same commands = identical state after one simulated hour', () => {
  const a = scriptedRun(42);
  const b = scriptedRun(42);
  assert.equal(stateHash(a.getState()), stateHash(b.getState()));
  assert.ok(a.getState().stats.arrivalsSpawned > 20);
});

test('different seeds diverge', () => {
  assert.notEqual(stateHash(scriptedRun(1).getState()), stateHash(scriptedRun(2).getState()));
});

test('replaying the command log reproduces the run exactly', () => {
  const original = scriptedRun(7);
  const copy = replay(makeScenario(7), original.getCommandLog(), ONE_HOUR);
  assert.equal(stateHash(copy.getState()), stateHash(original.getState()));
});
