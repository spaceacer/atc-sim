// I (intercept) and L (land). By default both land; with the scenario option
// requireLandingClearance, I is the approach clearance only and L must follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_CLEARANCE_NM, Simulation } from '../src/engine/index.js';
import { parseCommand } from '../src/commands/parser.js';
import { XDEM } from '../src/data/airports/xdem.js';
import { emptyScenario, emptySim, ticks } from './helpers.js';

/** A practice-field sim where I and L are separate clearances. */
function separateSim() {
  return new Simulation({ ...emptyScenario(), options: { requireLandingClearance: true } });
}

function events(sim: ReturnType<typeof emptySim>, seconds: number, stop: (type: string) => boolean) {
  const seen: { type: string; reason?: string }[] = [];
  for (let i = 0; i < ticks(seconds, sim); i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      seen.push({ type: e.type, reason: 'reason' in e ? e.reason : undefined });
      if (stop(e.type)) return seen;
    }
  }
  return seen;
}

test('parser: I 27 is the approach clearance, L 27 the landing clearance', () => {
  const r = parseCommand('igo12 c 240 i 27');
  assert.ok(r.ok);
  assert.deepEqual(r.commands[1], { type: 'intercept', callsign: 'IGO12', runway: '27' });
  const bad = parseCommand('IGO12 I');
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.error, /I needs a runway/);
});

test('separate clearances: cleared to intercept, established and descending, but goes around at 4 nm without landing clearance', () => {
  const sim = separateSim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  const r = sim.command({ type: 'intercept', callsign: 'TST1', runway: '27' });
  assert.equal(r.ok, true);
  assert.match(r.message, /cleared to intercept/);
  assert.equal(ac.landingCleared, false);

  let lowest = Infinity;
  let missed: string | undefined;
  for (let i = 0; i < ticks(10 * 60, sim) && missed === undefined; i++) {
    sim.step();
    if (ac.lateralMode === 'localizer') lowest = Math.min(lowest, ac.altitude);
    for (const e of sim.drainEvents()) if (e.type === 'missedApproach') missed = e.reason;
  }
  assert.equal(missed, `not cleared to land by ${LANDING_CLEARANCE_NM} nm`);
  assert.ok(lowest < 1500, `should descend on the glidepath before the landing clearance (lowest ${lowest})`);
  const threshold = XDEM.runways.find((r) => r.id === '27')!.thresholdX;
  assert.ok(Math.abs(ac.x - threshold - LANDING_CLEARANCE_NM) < 0.3, `went around ${ac.x - threshold} nm out`);
  assert.equal(sim.getState().stats.missedApproaches, 1);
  assert.equal(sim.getState().stats.score, -5);
});

test('default: I lands by itself, exactly like L', () => {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  const r = sim.command({ type: 'intercept', callsign: 'TST1', runway: '27' });
  assert.equal(r.message, 'TST1 cleared to intercept and land runway 27');
  assert.equal(ac.landingCleared, true);
  const seen = events(sim, 10 * 60, (t) => t === 'landed' || t === 'missedApproach');
  assert.equal(seen.at(-1)?.type, 'landed');
  assert.equal(sim.getState().stats.score, 10);
});

test('separate clearances: I then L on final: lands', () => {
  const sim = separateSim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  sim.command({ type: 'intercept', callsign: 'TST1', runway: '27' });
  events(sim, 5 * 60, (t) => t === 'localizerCaptured');
  assert.equal(ac.lateralMode, 'localizer');
  const r = sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  assert.equal(r.ok, true);
  assert.equal(r.message, 'TST1 runway 27, cleared to land');
  const seen = events(sim, 5 * 60, (t) => t === 'landed' || t === 'missedApproach');
  assert.equal(seen.at(-1)?.type, 'landed');
});

test('L given first still covers the approach and the landing', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  const seen = events(sim, 10 * 60, (t) => t === 'landed' || t === 'missedApproach');
  assert.equal(seen.at(-1)?.type, 'landed');
});

test('separate clearances: repeated clearances are refused with a reason; go-around clears both', () => {
  const sim = separateSim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 14, y: 2, altitude: 3000, heading: 240, speed: 210 });
  sim.command({ type: 'intercept', callsign: 'TST1', runway: '27' });
  const again = sim.command({ type: 'intercept', callsign: 'TST1', runway: '27' });
  assert.equal(again.ok, false);
  assert.match(again.message, /already cleared for the approach/);
  assert.equal(sim.command({ type: 'land', callsign: 'TST1', runway: '27' }).ok, true);
  const twice = sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  assert.equal(twice.ok, false);
  assert.match(twice.message, /already cleared to land/);
  const ga = sim.command({ type: 'goAround', callsign: 'TST1' });
  assert.match(ga.message, /approach clearance cancelled/);
  assert.equal(ac.landingCleared, false);
  assert.equal(ac.runway, null);
});

test('departures cannot be cleared to intercept', () => {
  const sim = emptySim();
  sim.addAircraft({ callsign: 'DEP1', x: 10, y: 0, altitude: 3000, heading: 270, isArrival: false });
  const r = sim.command({ type: 'intercept', callsign: 'DEP1', runway: '27' });
  assert.equal(r.ok, false);
});
