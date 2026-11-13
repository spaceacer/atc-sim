import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySim, ticks } from './helpers.js';

test('turns the short way at 3 deg/s and stops on the assigned heading', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 90 });
  assert.equal(sim.command({ type: 'heading', callsign: 'TST1', heading: 120 }).ok, true);
  sim.run(ticks(5, sim));
  assert.ok(Math.abs(ac.heading - 105) < 1e-9, `expected 105 after 5 s, got ${ac.heading}`);
  sim.run(ticks(10, sim));
  assert.equal(ac.heading, 120);
});

test('forced left turn goes the long way round', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 90 });
  sim.command({ type: 'heading', callsign: 'TST1', heading: 120, turn: 'L' });
  sim.run(ticks(10, sim));
  assert.ok(Math.abs(ac.heading - 60) < 1e-9, `expected 060 after 10 s left, got ${ac.heading}`);
  sim.run(ticks(120, sim));
  assert.equal(ac.heading, 120);
});

test('climbs at its type rate and doubles when expedited', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 90, category: 'medium' });
  sim.command({ type: 'altitude', callsign: 'TST1', altitude: 9000 });
  sim.run(ticks(60, sim));
  assert.equal(Math.round(ac.altitude), 7500); // A320: 2,500 ft/min
  sim.command({ type: 'altitude', callsign: 'TST1', altitude: 12000, expedite: true });
  sim.run(ticks(30, sim));
  assert.equal(Math.round(ac.altitude), 10000); // 5,000 ft/min for 30 s
});

test('moves 250 kt for one minute = 4.17 nm', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 0, altitude: 5000, heading: 90, speed: 250 });
  sim.run(ticks(60, sim));
  assert.ok(Math.abs(ac.x - 250 / 60) < 1e-9);
  assert.ok(Math.abs(ac.y) < 1e-9);
});

test('rejects speeds outside the performance envelope', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 90, category: 'heavy' });
  assert.equal(sim.command({ type: 'speed', callsign: 'TST1', speed: 120 }).ok, false);
  assert.equal(sim.command({ type: 'speed', callsign: 'TST1', speed: 210 }).ok, true);
  assert.equal(sim.command({ type: 'speed', callsign: 'NOPE1', speed: 210 }).ok, false);
});

test('aircraft leaving the radar range are removed and penalised', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'TST1', x: 31.5, y: 0, altitude: 5000, heading: 90, speed: 250 });
  sim.run(ticks(30, sim));
  assert.equal(sim.getState().aircraft.length, 0);
  assert.equal(sim.getState().stats.leftAirspace, 1);
  assert.ok(sim.drainEvents().some((e) => e.type === 'leftAirspace'));
});
