import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, type Aircraft } from '../src/engine/index.js';
import { emptySim, emptyScenario, ticks } from './helpers.js';

/** A departure holding short of 27 at the demo field, exit BRAVO (east) at 9,000 ft. */
function departure(sim: Simulation, exitFix = 'BRAVO'): Aircraft {
  return sim.addAircraft({
    callsign: 'DEP1',
    x: 0.9,
    y: 0,
    altitude: 0,
    heading: 270,
    speed: 0,
    targetAltitude: 5000,
    isArrival: false,
    status: 'waiting',
    runway: '27',
    exitFix,
    exitAltitude: 9000,
  });
}

function runUntil(sim: Simulation, seconds: number, done: () => boolean): string[] {
  const types: string[] = [];
  for (let i = 0; i < ticks(seconds, sim) && !done(); i++) {
    sim.step();
    for (const e of sim.drainEvents()) types.push(e.type);
  }
  return types;
}

test('takeoff roll, lift-off at rotate speed, runway heading until 500 ft', () => {
  const sim = emptySim();
  const ac = departure(sim);
  sim.command({ type: 'heading', callsign: 'DEP1', heading: 360 });
  assert.equal(sim.command({ type: 'takeoff', callsign: 'DEP1' }).ok, true);
  assert.equal(ac.status, 'lineup', 'lines up first');
  assert.equal(ac.groundSec, 25, 'A320: 35 s line-up, 10 s quicker as a rolling start');
  runUntil(sim, 30, () => ac.status === 'rolling');
  assert.equal(ac.status, 'rolling');
  const events = runUntil(sim, 120, () => ac.status === 'airborne');
  assert.ok(events.includes('tookOff'));
  assert.equal(ac.speed, 140); // A320 rotate speed (V2 145 - 5)
  assert.ok(ac.x < 0.9, 'rolled west along runway 27');
  sim.run(ticks(5, sim));
  assert.equal(ac.heading, 270, 'no turn below 500 ft');
  sim.run(ticks(60, sim));
  assert.equal(ac.heading, 360, 'turned to the assigned heading after 500 ft');
});

test('line up and wait takes time; a takeoff clearance while lining up rolls once lined up', () => {
  const sim = emptySim();
  const ac = departure(sim);
  assert.equal(sim.command({ type: 'lineUp', callsign: 'DEP1' }).ok, true);
  assert.equal(ac.groundSec, 35);
  sim.run(ticks(20, sim));
  assert.equal(ac.status, 'lineup');
  assert.match(sim.command({ type: 'lineUp', callsign: 'DEP1' }).message, /already lining up/);
  assert.equal(sim.command({ type: 'takeoff', callsign: 'DEP1' }).ok, true);
  assert.equal(ac.status, 'lineup', 'still lining up');
  const events = runUntil(sim, 20, () => ac.status === 'rolling');
  assert.equal(ac.status, 'rolling');
  assert.ok(!events.includes('linedUp'), 'cleared for takeoff: no stop once lined up');
});

test('A rejects a takeoff below V1, refuses above it, and cancels a line-up', () => {
  const sim = emptySim();
  const ac = departure(sim);
  sim.command({ type: 'takeoff', callsign: 'DEP1' });
  runUntil(sim, 40, () => ac.status === 'rolling' && ac.speed > 60);
  const r = sim.command({ type: 'goAround', callsign: 'DEP1' });
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /stop immediately/);
  runUntil(sim, 60, () => ac.speed === 0);
  assert.equal(ac.status, 'lineup', 'stopped on the runway, vacating');
  assert.ok(ac.aborting);
  assert.match(sim.command({ type: 'takeoff', callsign: 'DEP1' }).message, /vacating/);
  const events = runUntil(sim, 60, () => ac.status === 'waiting');
  assert.ok(events.includes('vacated'));
  assert.equal(ac.status, 'waiting', 'back at the holding point');

  // Past V1 the takeoff continues.
  sim.command({ type: 'takeoff', callsign: 'DEP1' });
  runUntil(sim, 120, () => ac.status === 'rolling' && ac.speed >= 135);
  assert.match(sim.command({ type: 'goAround', callsign: 'DEP1' }).message, /past V1/);

  // Cancel a line-up.
  const sim2 = emptySim();
  const ac2 = departure(sim2);
  sim2.command({ type: 'lineUp', callsign: 'DEP1' });
  assert.match(sim2.command({ type: 'goAround', callsign: 'DEP1' }).message, /cancel line-up/);
  runUntil(sim2, 60, () => ac2.status === 'waiting');
  assert.equal(ac2.status, 'waiting');
});

test('a departure holding short of a runway that closes is sent to the runway in use', () => {
  // Wind from the west: 27 in use. Then it swings to the east, closing 27.
  const sim = new Simulation({ ...emptySim().scenario, weather: { variable: true, initialWind: { direction: 270, speed: 10 } } });
  const ac = departure(sim);
  assert.equal(ac.runway, '27');
  sim.getState().wind.direction = 90;
  sim.getState().wind.speed = 15;
  const events: string[] = [];
  for (let i = 0; i < ticks(120, sim) && ac.runway === '27'; i++) {
    sim.step();
    for (const e of sim.drainEvents()) events.push(e.type);
  }
  assert.ok(!sim.getState().runwaysInUse.includes('27'));
  assert.equal(ac.runway, '09');
  assert.ok(events.includes('runwayReassigned'));
  assert.equal(ac.heading, 90);
  const w = sim.command({ type: 'lineUp', callsign: 'DEP1' });
  assert.equal(w.ok, true, w.message);
  assert.match(w.message, /runway 09/);
});

test('leaving through the assigned exit fix high enough scores', () => {
  const sim = emptySim();
  const ac = departure(sim);
  sim.command({ type: 'direct', callsign: 'DEP1', fixes: ['BRAVO'] });
  sim.command({ type: 'altitude', callsign: 'DEP1', altitude: 10000 });
  sim.command({ type: 'takeoff', callsign: 'DEP1' });
  const events = runUntil(sim, 20 * 60, () => ac.status === 'exited');
  assert.ok(events.includes('departed'), events.join());
  assert.equal(sim.getState().stats.departed, 1);
  assert.equal(sim.getState().stats.score, 10);
});

test('leaving too low or through the wrong edge is penalised', () => {
  const sim = emptySim();
  const ac = departure(sim, 'DELTA'); // west edge, runway 27 points west
  sim.command({ type: 'takeoff', callsign: 'DEP1' }); // stays at 5,000 ft
  runUntil(sim, 20 * 60, () => ac.status === 'exited');
  assert.equal(sim.getState().stats.wrongExits, 1);
  assert.equal(sim.getState().stats.score, -10);
});

test('takeoff and landing refused with a tailwind over 5 kt', () => {
  const sim = new Simulation(emptyScenario(1, { direction: 90, speed: 12 })); // easterly: 27 has a tailwind
  departure(sim);
  const r = sim.command({ type: 'takeoff', callsign: 'DEP1' });
  assert.equal(r.ok, false);
  assert.match(r.message, /tailwind/);
  assert.deepEqual(sim.getState().runwaysInUse, ['09']);
  assert.equal(sim.command({ type: 'takeoff', callsign: 'DEP1', runway: '09' }).ok, true);

  sim.addAircraft({ callsign: 'ARR1', x: 12, y: 0, altitude: 3000, heading: 270, speed: 200 });
  assert.equal(sim.command({ type: 'land', callsign: 'ARR1', runway: '27' }).ok, false);
});

test('arrival goes around when the runway is occupied at the threshold', () => {
  const sim = emptySim();
  departure(sim);
  sim.addAircraft({ callsign: 'ARR1', x: 4, y: 0, altitude: 1200, heading: 270, speed: 140 });
  assert.equal(sim.command({ type: 'land', callsign: 'ARR1', runway: '27' }).ok, true);
  assert.equal(sim.command({ type: 'lineUp', callsign: 'DEP1' }).ok, true);
  let reason = '';
  for (let i = 0; i < ticks(180, sim) && !reason; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'missedApproach') reason = e.reason;
  }
  assert.match(reason, /occupied by DEP1/);
  // And a second takeoff is refused while another aircraft rolls.
});

test('direct-to flies to the fix, then the next one on the route', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 0, y: 0, altitude: 6000, heading: 90 });
  sim.command({ type: 'direct', callsign: 'TST1', fixes: ['NORTA', 'NIBOR'] });
  let minNorta = Infinity;
  let minNibor = Infinity;
  for (let i = 0; i < ticks(15 * 60, sim); i++) {
    sim.step();
    minNorta = Math.min(minNorta, Math.hypot(ac.x - 12, ac.y - 12));
    minNibor = Math.min(minNibor, Math.hypot(ac.x + 12, ac.y - 12));
  }
  assert.ok(minNorta < 1, `passed NORTA at ${minNorta.toFixed(2)} nm`);
  assert.ok(minNibor < 1, `passed NIBOR at ${minNibor.toFixed(2)} nm`);
  assert.equal(ac.lateralMode, 'heading', 'route finished: back to heading mode');
});

test('arrivals spawn on the edge at 4,000-8,000 ft; departures hold short', () => {
  const sim = new Simulation({ ...emptyScenario(3), traffic: {
    arrivals: { minIntervalSec: 30, maxIntervalSec: 30, firstSec: 0 },
    departures: { minIntervalSec: 60, maxIntervalSec: 60, firstSec: 0 },
  } });
  const { halfWidth, halfHeight } = sim.scenario.airport.boundary;
  for (let i = 0; i < ticks(10 * 60, sim); i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type !== 'spawned') continue;
      const ac = sim.getState().aircraft.find((a) => a.callsign === e.callsign)!;
      if (e.isArrival) {
        assert.ok(ac.altitude >= 4000 && ac.altitude <= 8000 && ac.altitude % 1000 === 0, `alt ${ac.altitude}`);
        const onEdge = Math.abs(Math.abs(ac.x) - halfWidth) < 1e-9 || Math.abs(Math.abs(ac.y) - halfHeight) < 1e-9;
        assert.ok(onEdge, `spawned at ${ac.x}, ${ac.y}`);
      } else {
        assert.ok(ac.status === 'waiting' || ac.status === 'lineup', ac.status);
        assert.ok(ac.exitFix && ac.exitAltitude >= 9000);
      }
    }
  }
  assert.ok(sim.getState().stats.departuresSpawned >= 4);
});
