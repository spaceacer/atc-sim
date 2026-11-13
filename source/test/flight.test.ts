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

test('climbs at its type rate after easing in; expedite is x1.5 up to 3,000 ft/min', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 90, category: 'medium' });
  sim.command({ type: 'altitude', callsign: 'TST1', altitude: 9000 });
  sim.run(ticks(2, sim));
  assert.ok(ac.verticalSpeed > 0 && ac.verticalSpeed <= 500, 'the climb starts gently');
  sim.run(ticks(58, sim));
  assert.equal(ac.verticalSpeed, 2500); // A320: 2,500 ft/min once established
  // 60 s at 2,500 ft/min, less the 10 s easing in (about 208 ft).
  assert.ok(Math.abs(ac.altitude - (5000 + 2500 - 208)) < 20, String(ac.altitude));
  sim.command({ type: 'altitude', callsign: 'TST1', altitude: 12000, expedite: true });
  sim.run(ticks(10, sim));
  assert.equal(ac.verticalSpeed, 3000); // 2,500 x 1.5 = 3,750, capped at 3,000
});

test('descents ease in, stay within 2,000 ft/min, and level off smoothly', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 8000, heading: 90, category: 'medium' });
  sim.command({ type: 'altitude', callsign: 'TST1', altitude: 4000 });
  let maxRate = 0;
  let lastRate = 0;
  for (let i = 0; i < ticks(200, sim); i++) {
    sim.step();
    maxRate = Math.max(maxRate, -ac.verticalSpeed);
    if (ac.altitude < 4300 && ac.altitude > 4000) assert.ok(-ac.verticalSpeed <= -lastRate || lastRate === 0, 'slows while levelling off');
    lastRate = ac.verticalSpeed;
  }
  assert.equal(ac.altitude, 4000);
  assert.equal(ac.verticalSpeed, 0);
  assert.ok(maxRate <= 2000, String(maxRate));
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
