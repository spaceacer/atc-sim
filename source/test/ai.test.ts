import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtcEnv } from '../src/ai/env.js';
import { ACTION_TYPES } from '../src/ai/actions.js';
import { AIRCRAFT_FEATURES, MAX_AIRCRAFT, OBS_SIZE } from '../src/ai/observe.js';

test('vector observation has the documented size and is deterministic', () => {
  const run = () => {
    const env = new AtcEnv({ traffic: 'busy', episodeMinutes: 10 });
    env.reset(4);
    let last = env.step();
    for (let i = 0; i < 30; i++) last = env.step();
    return last;
  };
  const a = run();
  const b = run();
  assert.equal(a.obs.vector?.length, OBS_SIZE);
  assert.deepEqual(Array.from(a.obs.vector!), Array.from(b.obs.vector!));
  assert.equal(a.reward, b.reward);
});

test('an aircraft keeps its slot while others come and go', () => {
  const env = new AtcEnv({ traffic: 'busy', observation: 'both', episodeMinutes: 30 });
  env.reset(9);
  let r = env.step({ ticks: 120 });
  const first = r.obs.state!.aircraft[0];
  const slot = first.slot;
  for (let i = 0; i < 20; i++) {
    r = env.step();
    const same = r.obs.state!.aircraft.find((x) => x.callsign === first.callsign);
    if (!same) break;
    assert.equal(same.slot, slot);
  }
  assert.ok(slot !== null && slot < MAX_AIRCRAFT);
});

test('numeric actions decode to the same commands a human types', () => {
  const env = new AtcEnv({ traffic: 'busy', observation: 'both', episodeMinutes: 10 });
  env.reset(2);
  let r = env.step({ ticks: 120 });
  const ac = r.obs.state!.aircraft.find((x) => x.status === 'airborne')!;
  const heading = ACTION_TYPES.findIndex((t) => t.name === 'heading');
  r = env.step({ actions: [[ac.slot!, heading, 26]], ticks: 1 }); // param 26 -> 270
  const after = r.obs.state!.aircraft.find((x) => x.callsign === ac.callsign)!;
  assert.equal(after.targetHeading, 270);
  // The vector carries it too: target heading sin/cos for that slot.
  const base = ac.slot! * AIRCRAFT_FEATURES;
  assert.ok(Math.abs(r.obs.vector![base + 19] - -1) < 1e-6, 'target_heading_sin = -1 for 270');
});

test('text commands work and bad ones are reported, not thrown', () => {
  const env = new AtcEnv({ observation: 'state', episodeMinutes: 5 });
  env.reset(1);
  const r = env.step({ commands: ['NOPE', 'ZZZ999 C 5'] });
  assert.equal(r.info.rejected.length, 2);
});

test('intercept action and landing_cleared feature: approach first, then landing clearance', async () => {
  const { Simulation } = await import('../src/engine/index.js');
  const { SlotMap, encodeVector, AIRCRAFT_FEATURE_NAMES } = await import('../src/ai/observe.js');
  const { decodeAction } = await import('../src/ai/actions.js');
  const { emptyScenario } = await import('./helpers.js');
  const sim = new Simulation({ ...emptyScenario(), options: { requireLandingClearance: true } });
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  const airport = sim.scenario.airport;
  const slots = new SlotMap();
  slots.sync(sim.getState().aircraft);
  const slot = slots.slotOf(ac.id)!;
  const rwy = airport.runways.findIndex((r) => r.id === '27');
  const intercept = ACTION_TYPES.findIndex((t) => t.name === 'intercept');
  const land = ACTION_TYPES.findIndex((t) => t.name === 'land');
  assert.equal(intercept, 11, 'action numbers never change: new actions are only added at the end');
  assert.equal(ACTION_TYPES[12].name, 'takeoff_intersection');
  const cleared = AIRCRAFT_FEATURE_NAMES.indexOf('landing_cleared');

  const cmd = decodeAction([slot, intercept, rwy], sim.getState(), airport, slots);
  assert.deepEqual(cmd, { type: 'intercept', callsign: 'TST1', runway: '27' });
  assert.equal(sim.command(cmd!).ok, true);
  let v = encodeVector(sim.getState(), airport, slots, 0);
  assert.equal(v[slot * AIRCRAFT_FEATURES + cleared], 0);
  assert.equal(sim.command(decodeAction([slot, land, rwy], sim.getState(), airport, slots)!).ok, true);
  v = encodeVector(sim.getState(), airport, slots, 0);
  assert.equal(v[slot * AIRCRAFT_FEATURES + cleared], 1);
  assert.equal(OBS_SIZE, MAX_AIRCRAFT * AIRCRAFT_FEATURES + 13);
});
