import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySim, ticks } from './helpers.js';

test('head-on pair at the same level: one loss event, flags set while inside 3 nm', () => {
  const sim = emptySim();
  const a = sim.addAircraft({ callsign: 'AAA1', x: -5, y: 10, altitude: 6000, heading: 90, speed: 250 });
  const b = sim.addAircraft({ callsign: 'BBB1', x: 5, y: 10, altitude: 6000, heading: 270, speed: 250 });
  let losses = 0;
  let flagged = false;
  for (let i = 0; i < ticks(120, sim); i++) {
    sim.step();
    losses += sim.drainEvents().filter((e) => e.type === 'separationLoss').length;
    if (a.inConflict && b.inConflict) flagged = true;
  }
  assert.equal(losses, 1, 'the same pair must count once per encounter');
  assert.ok(flagged);
  assert.equal(sim.getState().stats.separationLosses, 1);
  assert.equal(sim.getState().stats.score, -20);
});

test('1,000 ft vertical separation is enough', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'AAA1', x: -5, y: 10, altitude: 6000, heading: 90, speed: 250 });
  sim.addAircraft({ callsign: 'BBB1', x: 5, y: 10, altitude: 7000, heading: 270, speed: 250 });
  sim.run(ticks(120, sim));
  assert.equal(sim.getState().stats.separationLosses, 0);
});
