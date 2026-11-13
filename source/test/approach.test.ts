import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySim, ticks } from './helpers.js';

test('a 30 degree intercept captures the centreline and lands on 27', () => {
  const sim = emptySim();
  // 14 nm east, 2 nm north of the 27 centreline, heading 240 = 30 deg intercept.
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  assert.equal(sim.command({ type: 'land', callsign: 'TST1', runway: '27' }).ok, true);

  let captured = false;
  let landed = false;
  for (let i = 0; i < ticks(10 * 60, sim) && !landed; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'localizerCaptured') captured = true;
      if (e.type === 'landed') landed = true;
      assert.notEqual(e.type, 'missedApproach');
    }
    if (captured && !landed) assert.ok(Math.abs(ac.y) < 0.5, `drifted off centreline: y=${ac.y}`);
  }
  assert.ok(captured, 'never captured the centreline');
  assert.ok(landed, 'never landed');
  assert.equal(sim.getState().stats.landed, 1);
  assert.equal(sim.getState().aircraft.length, 0);
});

test('aircraft slows automatically to approach speed on final', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 12, y: 0, altitude: 2500, heading: 270, speed: 250, category: 'heavy' });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  sim.run(ticks(60, sim));
  assert.equal(ac.lateralMode, 'localizer');
  // Inside 5 nm by now? Keep stepping until close in, then check speed.
  while (ac.x > 2 && sim.getState().aircraft.length > 0) sim.step();
  assert.equal(ac.speed, 150); // heavy approach speed
});

test('landing clearance is refused when too high or badly aligned', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'HIGH1', x: 15, y: 0, altitude: 6000, heading: 270 });
  sim.addAircraft({ callsign: 'WIDE1', x: 15, y: 5, altitude: 3000, heading: 180 });
  const high = sim.command({ type: 'land', callsign: 'HIGH1', runway: '27' });
  const wide = sim.command({ type: 'land', callsign: 'WIDE1', runway: '27' });
  const bogus = sim.command({ type: 'land', callsign: 'WIDE1', runway: '18' });
  assert.equal(high.ok, false);
  assert.match(high.message, /too high/);
  assert.equal(wide.ok, false);
  assert.match(wide.message, /more than 60/);
  assert.equal(bogus.ok, false);
});

/** Step until the aircraft lands, goes around, or time runs out; returns what happened. */
function fly(sim: ReturnType<typeof emptySim>, seconds: number): { captured: boolean; landed: boolean; missed: string | null } {
  const out = { captured: false, landed: false, missed: null as string | null };
  for (let i = 0; i < ticks(seconds, sim) && !out.landed && out.missed === null; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'localizerCaptured') out.captured = true;
      if (e.type === 'landed') out.landed = true;
      if (e.type === 'missedApproach') out.missed = e.reason;
    }
  }
  return out;
}

for (const offset of [0.3, 1, 3, -2]) {
  test(`on the runway heading but ${offset} nm off the centreline: joins by itself and lands`, () => {
    const sim = emptySim();
    sim.addAircraft({ callsign: 'TST1', x: 15, y: offset, altitude: 3000, heading: 270, speed: 210 });
    assert.equal(sim.command({ type: 'land', callsign: 'TST1', runway: '27' }).ok, true);
    const r = fly(sim, 10 * 60);
    assert.equal(r.missed, null);
    assert.ok(r.captured && r.landed);
  });
}

test('heading away from the centreline: turns back by itself, no more than 30 degrees off', () => {
  const sim = emptySim();
  // 2 nm north, heading 300: diverging from the 27 centreline.
  const ac = sim.addAircraft({ callsign: 'TST1', x: 15, y: 2, altitude: 3000, heading: 300, speed: 210 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  sim.step();
  assert.equal(Math.round(ac.targetHeading), 240); // runway heading 270, 30 degrees toward the centreline
  const r = fly(sim, 10 * 60);
  assert.ok(r.captured && r.landed);
});

test("a heading that meets the centreline in time is kept: the aircraft does not take over", () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 250, speed: 210 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  for (let i = 0; i < ticks(30, sim); i++) {
    sim.step();
    if (ac.lateralMode === 'approach') assert.equal(ac.targetHeading, 250);
  }
});

test('a heading given with the clearance is kept while the aircraft is still turning onto it', () => {
  const sim = emptySim();
  // Heading 300 (diverging) but told to fly 225, a 45 degree intercept, together with the clearance.
  const ac = sim.addAircraft({ callsign: 'TST1', x: 16, y: 3, altitude: 3000, heading: 300, speed: 210 });
  sim.command({ type: 'heading', callsign: 'TST1', heading: 225 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  for (let i = 0; i < ticks(40, sim) && ac.lateralMode === 'approach'; i++) {
    sim.step();
    assert.equal(ac.targetHeading, 225);
  }
});

test('reaching the runway without having lined up: automatic go-around', () => {
  const sim = emptySim();
  // Abeam the field, 6 nm north on the runway heading: cannot reach the centreline before the threshold.
  const ac = sim.addAircraft({ callsign: 'TST1', x: 2, y: 6, altitude: 3000, heading: 270, speed: 210 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  const r = fly(sim, 5 * 60);
  assert.equal(r.missed, 'reached the runway without lining up');
  assert.equal(ac.lateralMode, 'heading');
  assert.equal(ac.landingCleared, false);
  assert.equal(sim.getState().stats.missedApproaches, 1);
});

test('a clearance is refused once the aircraft is past the threshold', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'TST1', x: -3, y: 1, altitude: 3000, heading: 270 });
  const r = sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  assert.equal(r.ok, false);
  assert.match(r.message, /past the runway 27 threshold/);
});

test('too high on final ends in a missed approach: runway heading, climb to 3,000 ft', () => {
  const sim = emptySim();
  // Established 2 nm out at 3,000 ft: far above the 640 ft glidepath, cannot get down in time.
  const ac = sim.addAircraft({ callsign: 'TST1', x: 2.9, y: 0, altitude: 3000, heading: 270, speed: 180 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  let missed = false;
  for (let i = 0; i < ticks(120, sim) && !missed; i++) {
    sim.step();
    missed = sim.drainEvents().some((e) => e.type === 'missedApproach');
  }
  assert.ok(missed);
  assert.equal(ac.lateralMode, 'heading');
  assert.equal(ac.targetAltitude, 3000);
  assert.equal(sim.getState().stats.missedApproaches, 1);
});

test('a heading command cancels the approach', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 10, y: 0, altitude: 2500, heading: 270, speed: 180 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  sim.run(ticks(10, sim));
  assert.equal(ac.lateralMode, 'localizer');
  const r = sim.command({ type: 'heading', callsign: 'TST1', heading: 360 });
  assert.match(r.message, /approach cancelled/);
  assert.equal(ac.lateralMode, 'heading');
  assert.equal(ac.runway, null);
});
