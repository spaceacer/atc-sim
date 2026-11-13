import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Aircraft, Simulation } from '../src/engine/index.js';
import { emptySim, ticks } from './helpers.js';

test('heading 000 means north', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 10, altitude: 5000, heading: 330 });
  assert.equal(sim.command({ type: 'heading', callsign: 'TST1', heading: 0 }).ok, true);
  sim.run(ticks(30, sim));
  assert.equal(ac.heading, 360);
});

test('holding at a fix flies a racetrack and keeps passing the fix', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 0, altitude: 6000, heading: 45, speed: 220 });
  assert.equal(sim.command({ type: 'hold', callsign: 'TST1', fix: 'NORTA' }).ok, true); // (12, 12)
  let passes = 0;
  let near = false;
  let maxAway = 0;
  for (let i = 0; i < ticks(20 * 60, sim); i++) {
    sim.step();
    const d = Math.hypot(ac.x - 12, ac.y - 12);
    if (i > ticks(5 * 60, sim)) maxAway = Math.max(maxAway, d);
    if (d < 0.8 && !near) passes++;
    near = d < 0.8;
  }
  assert.equal(ac.lateralMode, 'hold');
  assert.ok(passes >= 4, `passed the fix ${passes} times in 20 minutes`);
  assert.ok(maxAway < 6, `strayed ${maxAway.toFixed(1)} nm from the fix`);
});

test('hold at present position, then a heading leaves the hold', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: -10, y: 10, altitude: 6000, heading: 90, speed: 200 });
  sim.command({ type: 'hold', callsign: 'TST1', turn: 'L' });
  sim.run(ticks(20, sim));
  assert.ok(Math.abs(ac.heading - 30) < 1e-6, `left turn outbound, heading ${ac.heading}`);
  sim.command({ type: 'heading', callsign: 'TST1', heading: 180 });
  assert.equal(ac.lateralMode, 'heading');
  assert.equal(ac.hold, null);
});

test('go-around from final: missed approach with penalty', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'ARR1', x: 8, y: 0, altitude: 2500, heading: 270, speed: 180 });
  sim.command({ type: 'land', callsign: 'ARR1', runway: '27' });
  sim.run(ticks(10, sim));
  assert.equal(ac.lateralMode, 'localizer');
  assert.equal(sim.command({ type: 'goAround', callsign: 'ARR1' }).ok, true);
  assert.equal(ac.lateralMode, 'heading');
  assert.equal(ac.targetAltitude, 3000);
  assert.equal(sim.getState().stats.missedApproaches, 1);
  assert.equal(sim.command({ type: 'goAround', callsign: 'ARR1' }).ok, false);
});

test('conflict alert fires before separation is lost', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'AAA1', x: -6, y: 10, altitude: 6000, heading: 90, speed: 250 });
  sim.addAircraft({ callsign: 'BBB1', x: 6, y: 10, altitude: 6000, heading: 270, speed: 250 });
  let warnedAt = -1;
  let lostAt = -1;
  for (let i = 0; i < ticks(120, sim) && lostAt < 0; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'conflictWarning' && warnedAt < 0) warnedAt = sim.tick;
      if (e.type === 'separationLoss') lostAt = sim.tick;
    }
  }
  assert.ok(warnedAt > 0 && lostAt > warnedAt, `warned ${warnedAt}, lost ${lostAt}`);
  assert.ok((lostAt - warnedAt) * sim.dt >= 30, 'at least 30 s of warning');
});

test('no conflict alert for aircraft that will stay 1,000 ft apart', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'AAA1', x: -6, y: 10, altitude: 6000, heading: 90, speed: 250 });
  sim.addAircraft({ callsign: 'BBB1', x: 6, y: 10, altitude: 7000, heading: 270, speed: 250 });
  sim.run(ticks(120, sim));
  assert.equal(sim.getState().stats.conflictWarnings, 0);
});

function waitingDeparture(sim: Simulation): Aircraft {
  return sim.addAircraft({
    callsign: 'DEP1', x: 0.9, y: 0, altitude: 0, heading: 270, speed: 0, targetAltitude: 5000,
    isArrival: false, status: 'waiting', runway: '27', exitFix: 'BRAVO', exitAltitude: 9000,
  });
}

test('departures never line up or change runway by themselves', () => {
  const sim = emptySim();
  const dep = waitingDeparture(sim);
  sim.getState().runwaysInUse = ['09']; // as if the wind had turned easterly
  sim.run(ticks(300, sim));
  assert.equal(dep.status, 'waiting');
  assert.equal(dep.runway, '27');
  assert.equal(sim.command({ type: 'takeoff', callsign: 'DEP1', runway: '09' }).ok, true);
  assert.equal(dep.runway, '09');
});
