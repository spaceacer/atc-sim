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

test('two arrivals on the same final are judged on 2.5 nm lateral only', async () => {
  const { checkSeparation } = await import('../src/engine/rules/separation.js');
  const sim = emptySim();
  const mk = (cs: string, x: number, alt: number) =>
    sim.addAircraft({ callsign: cs, x, y: 0, altitude: alt, heading: 270, speed: 140, lateralMode: 'localizer', runway: '27' });
  const lead = mk('LEAD1', 4, 1100);
  const near = mk('FOL1', 4 + 2.7, 1900); // 2.7 nm behind: fine on final (would be a loss at 3 nm / 1,000 ft)
  assert.equal(checkSeparation([lead, near], new Set(), 0).length, 0);
  const tight = mk('FOL2', 4 + 2.3, 1700); // 2.3 nm behind: too close
  assert.equal(checkSeparation([lead, tight], new Set(), 0).length, 1);
  // Not both established on the final: the usual 3 nm / 1,000 ft applies.
  const other = sim.addAircraft({ callsign: 'OTH1', x: 4 + 2.7, y: 0, altitude: 1900, heading: 270, speed: 140 });
  assert.equal(checkSeparation([lead, other], new Set(), 0).length, 1);
});

test('runway conflict: an arrival close in to an occupied runway is alerted, then scored', () => {
  const place = (arrivalAtNm: number) => {
    const sim = emptySim();
    // XDEM runway 27 threshold is at x = 0.9 nm (departures in the tests start there).
    sim.addAircraft({ callsign: 'DEP1', x: 0.9, y: 0, altitude: 0, heading: 270, speed: 0, isArrival: false, status: 'lineup', runway: '27', groundSec: 0, exitFix: 'BRAVO', exitAltitude: 9000 });
    sim.addAircraft({ callsign: 'ARR1', x: 0.9 + arrivalAtNm, y: 0, altitude: 39 + arrivalAtNm * 318, heading: 270, speed: 130, targetSpeed: 130, lateralMode: 'localizer', runway: '27', landingCleared: true });
    const events: string[] = [];
    sim.step();
    for (const e of sim.drainEvents()) events.push(e.type);
    return { sim, events };
  };
  const far = place(3.5);
  assert.deepEqual(far.events, []);
  const mid = place(2);
  assert.ok(mid.events.includes('conflictWarning'));
  assert.ok(!mid.events.includes('runwayConflict'));
  assert.equal(mid.sim.getState().stats.score, 0);
  const close = place(0.8);
  assert.ok(close.events.includes('runwayConflict'));
  assert.equal(close.sim.getState().stats.score, -20);
  assert.equal(close.sim.getState().stats.separationLosses, 1);
  // Counted once, even as it goes on.
  close.sim.run(ticks(3, close.sim));
  assert.equal(close.sim.getState().stats.score <= -20 && close.sim.getState().stats.score >= -25, true);
  // A clear runway is no conflict.
  const sim = emptySim();
  sim.addAircraft({ callsign: 'ARR1', x: 1.5, y: 0, altitude: 270, heading: 270, speed: 130, lateralMode: 'localizer', runway: '27', landingCleared: true });
  sim.step();
  assert.equal(sim.getState().stats.score, 0);
});
