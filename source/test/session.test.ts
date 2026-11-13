import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Simulation, stateHash } from '../src/engine/index.js';
import { makeScenario } from '../src/data/scenarios.js';
import { parseSession, restoreSession, sessionFromSim } from '../src/data/session.js';

test('save -> JSON -> load reproduces the exact state', () => {
  const sim = new Simulation(makeScenario(99, 'vabb'));
  for (let t = 0; t < 2400; t++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'spawned' && e.isArrival) sim.command({ type: 'altitude', callsign: e.callsign, altitude: 4000 });
      if (e.type === 'spawned' && !e.isArrival) sim.command({ type: 'takeoff', callsign: e.callsign });
    }
  }
  const text = JSON.stringify(sessionFromSim(sim, 'vabb'));
  const parsed = parseSession(text);
  assert.ok(parsed.ok);
  const copy = restoreSession(parsed.file);
  assert.equal(copy.tick, sim.tick);
  assert.equal(stateHash(copy.getState()), stateHash(sim.getState()));
  assert.ok(sim.getState().stats.departed + sim.getState().aircraft.length > 0);
});

test('bundled scenario files are valid', () => {
  for (const name of readdirSync('scenarios')) {
    const parsed = parseSession(readFileSync(`scenarios/${name}`, 'utf8'));
    assert.ok(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.error}`);
    restoreSession(parsed.file).run(100);
  }
});

test('bad files get a clear error', () => {
  const r = parseSession('{"format":"atc-sim-session","version":1,"map":"kjfk","seed":1}');
  assert.ok(!r.ok && /unknown map/.test(r.error));
  assert.ok(!parseSession('hello').ok);
});
