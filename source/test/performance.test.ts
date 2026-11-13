// Per-type performance and the fleet mix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, TYPE_DATA, derive, performanceOf } from '../src/engine/index.js';
import { pickType } from '../src/engine/traffic/spawner.js';
import { createRng } from '../src/engine/rng.js';
import { VABB } from '../src/data/airports/vabb.js';
import { emptyScenario, emptySim, ticks } from './helpers.js';

test('every type has plausible derived values and says where its figures come from', () => {
  assert.equal(new Set(TYPE_DATA.map((d) => d.type)).size, TYPE_DATA.length);
  for (const d of TYPE_DATA) {
    const p = derive(d);
    assert.ok(d.sources.length > 10, `${d.type} has no sources`);
    assert.ok(p.approachSpeed >= 105 && p.approachSpeed <= 160, `${d.type} Vapp ${p.approachSpeed}`);
    assert.ok(p.touchdownSpeed < p.approachSpeed);
    assert.ok(p.minSpeed > p.approachSpeed && p.minSpeed < p.maxSpeed);
    const roll = p.touchdownSpeed / p.rolloutDecel;
    assert.ok(roll > 25 && roll < 70, `${d.type} rollout ${roll} s`);
    const takeoff = p.rotateSpeed / p.takeoffAccel;
    assert.ok(takeoff > 25 && takeoff < 70, `${d.type} takeoff roll ${takeoff} s`);
  }
});

test('on final each type flies its own approach speed: ATR 113 kt, 777-300ER 150 kt', () => {
  for (const [type, vapp] of [['AT76', 113], ['B77W', 150]] as const) {
    const sim = emptySim();
    const ac = sim.addAircraft({ callsign: 'TST1', x: 12, y: 0, altitude: 2500, heading: 270, speed: 200, type });
    sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
    while (ac.x > 2.5) sim.step();
    assert.equal(ac.speed, vapp, type);
    assert.equal(performanceOf(ac).approachSpeed, vapp);
  }
});

test('speeds outside the type envelope are refused', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'ATR1', x: 10, y: 10, altitude: 5000, heading: 90, speed: 200, type: 'AT76' });
  assert.equal(sim.command({ type: 'speed', callsign: 'ATR1', speed: 250 }).ok, false); // ATR limit 240
  assert.equal(sim.command({ type: 'speed', callsign: 'ATR1', speed: 160 }).ok, true);
});

test('Mumbai traffic follows its fleet weights; the turboprop and heavy shares scale them', () => {
  const count = (mix?: { turboprop?: number; heavy?: number }) => {
    const rng = createRng(5);
    const n: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const t = pickType(rng, VABB, mix).type;
      n[t] = (n[t] ?? 0) + 1;
    }
    return n;
  };
  const base = count();
  assert.ok((base.A20N ?? 0) > (base.A333 ?? 0) * 5, 'A320neo far more common than A330');
  for (const t of Object.keys(base)) assert.ok(VABB.fleet![t] > 0, `${t} not in the Mumbai fleet`);
  const moreProps = count({ turboprop: 3 });
  assert.ok((moreProps.AT76 ?? 0) > (base.AT76 ?? 0) * 2);
  const noHeavies = count({ heavy: 0 });
  for (const t of ['B77W', 'B788', 'B789', 'A333', 'A359']) assert.equal(noHeavies[t] ?? 0, 0);
});

test('scenario options: wider separation minima and alerts off', () => {
  const make = (options: object) => new Simulation({ ...emptyScenario(), options });
  for (const [options, lossExpected] of [[{}, false], [{ separation: { lateralNm: 5, verticalFt: 1000 } }, true]] as const) {
    const sim = make(options);
    sim.addAircraft({ callsign: 'AAA1', x: 0, y: 10, altitude: 5000, heading: 90, speed: 250 });
    sim.addAircraft({ callsign: 'BBB1', x: 0, y: 14, altitude: 5000, heading: 90, speed: 250 }); // 4 nm apart
    sim.step();
    assert.equal(sim.getState().stats.separationLosses > 0, lossExpected, JSON.stringify(options));
  }
  const quiet = make({ conflictLookaheadSec: 0 });
  quiet.addAircraft({ callsign: 'AAA1', x: -8, y: 10, altitude: 5000, heading: 90, speed: 250 });
  quiet.addAircraft({ callsign: 'BBB1', x: 8, y: 10, altitude: 5000, heading: 270, speed: 250 });
  quiet.run(ticks(20, quiet));
  assert.equal(quiet.getState().stats.conflictWarnings, 0);
});
