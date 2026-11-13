// Landing rollout: touchdown, deceleration to 0 on the runway, occupancy, then removal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceOf, XDEM_RUNWAY_HALF } from './rollout-helpers.js';
import { emptySim, ticks } from './helpers.js';

function landOne(type: string) {
  const sim = emptySim();
  const ac = sim.addAircraft({ callsign: 'TST1', x: 12, y: 0, altitude: 2500, heading: 270, speed: 180, type });
  sim.command({ type: 'land', callsign: 'TST1', runway: '27' });
  return { sim, ac };
}

test('touchdown, roll out decelerating along the runway, score +10 only when stopped', () => {
  const { sim, ac } = landOne('A320');
  let touchdownTick = -1;
  for (let i = 0; i < ticks(10 * 60, sim) && touchdownTick < 0; i++) {
    sim.step();
    if (sim.drainEvents().some((e) => e.type === 'touchdown')) touchdownTick = sim.tick;
  }
  assert.ok(touchdownTick > 0, 'never touched down');
  assert.equal(ac.status, 'rollout');
  assert.equal(sim.getState().stats.landed, 0);
  assert.equal(sim.getState().stats.score, 0);
  assert.ok(ac.speed <= performanceOf(ac).touchdownSpeed);

  let last = ac.speed;
  let landedAt = -1;
  for (let i = 0; i < ticks(120, sim) && landedAt < 0; i++) {
    sim.step();
    if (sim.drainEvents().some((e) => e.type === 'landed')) landedAt = sim.tick;
    else {
      assert.ok(ac.speed < last, 'decelerates every tick');
      assert.ok(Math.abs(ac.y) < 1e-9, 'stays on the centreline');
      last = ac.speed;
    }
  }
  assert.ok(landedAt > 0, 'never stopped');
  const seconds = (landedAt - touchdownTick) * sim.dt;
  const expected = performanceOf(ac).touchdownSpeed / performanceOf(ac).rolloutDecel;
  assert.ok(Math.abs(seconds - expected) < 2, `rollout took ${seconds} s, expected about ${expected}`);
  assert.ok(ac.x > -XDEM_RUNWAY_HALF, `stopped beyond the runway end (x=${ac.x})`);
  assert.equal(sim.getState().stats.landed, 1);
  assert.equal(sim.getState().stats.score, 10);
  assert.equal(sim.getState().aircraft.length, 0, 'removed once stopped');
});

test('a rolling-out aircraft occupies the runway: takeoff refused, the next arrival goes around', () => {
  const { sim, ac } = landOne('B77W');
  sim.addAircraft({ callsign: 'DEP1', x: 0.9, y: 0, altitude: 0, heading: 270, speed: 0, isArrival: false, status: 'waiting', runway: '27' });
  while (ac.status !== 'rollout') sim.step();
  const r = sim.command({ type: 'takeoff', callsign: 'DEP1' });
  assert.equal(r.ok, false);
  assert.match(r.message, /occupied by TST1/);

  // A second arrival placed on short final reaches the threshold during the rollout.
  sim.addAircraft({ callsign: 'TST2', x: 1.6, y: 0, altitude: 200, heading: 270, speed: 140, lateralMode: 'localizer', runway: '27', landingCleared: true });
  let missed: string | undefined;
  for (let i = 0; i < ticks(30, sim) && !missed; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'missedApproach' && e.callsign === 'TST2') missed = e.reason;
  }
  assert.equal(missed, 'runway occupied by TST1');
});

test('turboprops roll out shorter than heavies', () => {
  const atr = landOne('AT76');
  const b77 = landOne('B77W');
  const rolloutLength = ({ sim, ac }: ReturnType<typeof landOne>) => {
    while (ac.status !== 'rollout') sim.step();
    const x0 = ac.x;
    while (sim.getState().aircraft.length > 0) sim.step();
    return x0 - ac.x;
  };
  const atrM = rolloutLength(atr) * 1852;
  const b77M = rolloutLength(b77) * 1852;
  assert.ok(atrM < b77M, `ATR ${Math.round(atrM)} m vs 777 ${Math.round(b77M)} m`);
  assert.ok(atrM > 500 && atrM < 1200, `ATR rollout ${Math.round(atrM)} m`);
  assert.ok(b77M > 1500 && b77M < 2600, `777 rollout ${Math.round(b77M)} m`);
});
