// Intersection takeoffs, runway length per type, wake turbulence spacing, runway 32 visual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, WAKE_DEPARTURE_SEC, departureWakeSec } from '../src/engine/index.js';
import { VABB } from '../src/data/airports/vabb.js';
import { parseCommand } from '../src/commands/parser.js';
import { ticks } from './helpers.js';

const NONE = { minIntervalSec: 60, maxIntervalSec: 60, firstSec: 0, max: 0 };

function mumbai(direction = 270): Simulation {
  return new Simulation({ seed: 1, airport: VABB, traffic: { arrivals: NONE, departures: NONE }, weather: { initialWind: { direction, speed: 10 }, variable: false } });
}

function departure(sim: Simulation, callsign: string, type: string, category: 'medium' | 'heavy' = 'medium') {
  const r27 = VABB.runways.find((r) => r.id === '27')!;
  return sim.addAircraft({ callsign, type, category, x: r27.thresholdX, y: r27.thresholdY, altitude: VABB.elevation, heading: 270, speed: 0, isArrival: false, status: 'waiting', runway: '27', targetAltitude: 5000, targetSpeed: 250 });
}

test('parser: T 27 N4 and W 27 N4 carry the intersection', () => {
  const t = parseCommand('IGO1 T 27 N4');
  assert.ok(t.ok);
  assert.deepEqual(t.commands[0], { type: 'takeoff', callsign: 'IGO1', runway: '27', intersection: 'N4' });
  const w = parseCommand('IGO1 W 27 N6 C 5');
  assert.ok(w.ok);
  assert.equal(w.commands.length, 2);
  assert.equal((w.commands[0] as { intersection?: string }).intersection, 'N6');
});

test('intersection takeoff: starts down the runway, only if the type has enough runway left', () => {
  const sim = mumbai();
  const atr = departure(sim, 'IGO1', 'AT76');
  const a320 = departure(sim, 'IGO2', 'A320');
  const long = sim.command({ type: 'takeoff', callsign: 'IGO2', runway: '27', intersection: 'N6' });
  assert.equal(long.ok, false);
  assert.match(long.message, /N6 leaves 2,000 m, A320 needs 2,100 m/);
  const bad = sim.command({ type: 'takeoff', callsign: 'IGO1', runway: '27', intersection: 'Z9' });
  assert.match(bad.message, /no intersection Z9 on runway 27 \(available: N4, N6\)/);
  const r27 = VABB.runways.find((r) => r.id === '27')!;
  const ok = sim.command({ type: 'takeoff', callsign: 'IGO1', runway: '27', intersection: 'N6' });
  assert.equal(ok.ok, true, ok.message);
  assert.ok(atr.x < r27.thresholdX - 0.5, 'starts well down the runway');
  assert.equal(atr.fromIntersection, 'N6');
  assert.ok(a320); // still waiting at the threshold
});

test('wake turbulence: a medium waits 2 min behind a heavy, 3 min from an intersection', () => {
  assert.equal(departureWakeSec('heavy', 'medium', false), WAKE_DEPARTURE_SEC);
  assert.equal(departureWakeSec('heavy', 'medium', true), WAKE_DEPARTURE_SEC + 60);
  assert.equal(departureWakeSec('medium', 'heavy', false), 0);
  const sim = mumbai();
  departure(sim, 'UAE1', 'B77W', 'heavy');
  departure(sim, 'IGO1', 'A20N');
  departure(sim, 'IGO2', 'AT76');
  assert.equal(sim.command({ type: 'takeoff', callsign: 'UAE1' }).ok, true);
  sim.run(ticks(125, sim)); // 35 s to line up (rolling start), then airborne; runway clear
  const early = sim.command({ type: 'takeoff', callsign: 'IGO1' });
  assert.equal(early.ok, false);
  assert.match(early.message, /wake turbulence behind UAE1 \(B77W\), 30 s to wait/);
  sim.run(ticks(30, sim));
  const fromInt = sim.command({ type: 'takeoff', callsign: 'IGO2', runway: '27', intersection: 'N6' });
  assert.match(fromInt.message, /60 s to wait/, 'an extra minute from an intersection');
  assert.equal(sim.command({ type: 'takeoff', callsign: 'IGO1' }).ok, true);
});

test('runway 32 has no ILS: a visual approach, no centreline, the pilot still lines up', () => {
  const r32 = VABB.runways.find((r) => r.id === '32')!;
  assert.equal(r32.ils, false);
  for (const id of ['09', '27', '14']) assert.notEqual(VABB.runways.find((r) => r.id === id)!.ils, false);
  // Wind from the northwest puts 32 in use.
  const sim = mumbai(320);
  assert.ok(sim.getState().runwaysInUse.includes('32'));
  const h = (r32.heading * Math.PI) / 180;
  // 10 nm out on the extended centreline, offset 1 nm, flying the runway heading.
  const x = r32.thresholdX - Math.sin(h) * 10 + Math.cos(h) * 1;
  const y = r32.thresholdY - Math.cos(h) * 10 - Math.sin(h) * 1;
  sim.addAircraft({ callsign: 'IGO5', x, y, altitude: 2500, heading: r32.heading, speed: 180 });
  const r = sim.command({ type: 'land', callsign: 'IGO5', runway: '32' });
  assert.match(r.message, /cleared visual approach and to land runway 32/);
  let landed = false;
  for (let i = 0; i < ticks(8 * 60, sim) && !landed; i++) {
    sim.step();
    landed = sim.drainEvents().some((e) => e.type === 'touchdown');
  }
  assert.ok(landed);
});

test('line up behind a landing aircraft once it is well down the runway; takeoff only when it has stopped', () => {
  const sim = mumbai();
  const r27 = VABB.runways.find((r) => r.id === '27')!;
  departure(sim, 'IGO1', 'A20N');
  // An arrival just touching down on 27.
  const arr = sim.addAircraft({ callsign: 'AIC9', x: r27.thresholdX - 0.05, y: r27.thresholdY, altitude: VABB.elevation, heading: r27.heading, speed: 130, status: 'rollout', runway: '27' });
  const early = sim.command({ type: 'lineUp', callsign: 'IGO1' });
  assert.equal(early.ok, false);
  assert.match(early.message, /unable to line up: runway 27 occupied by AIC9/);
  sim.run(ticks(12, sim)); // now well past 600 m
  assert.equal(arr.status, 'rollout');
  assert.equal(sim.command({ type: 'lineUp', callsign: 'IGO1' }).ok, true);
  const go = sim.command({ type: 'takeoff', callsign: 'IGO1' });
  assert.equal(go.ok, false, 'not while the landing aircraft is still on the runway');
  while (sim.getState().aircraft.some((a) => a.callsign === 'AIC9')) sim.step();
  assert.equal(sim.command({ type: 'takeoff', callsign: 'IGO1' }).ok, true);
});
