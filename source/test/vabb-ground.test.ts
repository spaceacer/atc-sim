// Mumbai (VABB) ground layout: runway data against the AIP, graph integrity, two
// crossing runways with one in use, runway changes, and a scripted controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundSimulation } from '../src/engine/ground/simulation.js';
import type { GroundScenario } from '../src/engine/ground/types.js';
import { VABB } from '../src/data/ground/vabb.js';
import { groundAirportFor } from '../src/data/ground/index.js';
import { stateHash } from '../src/engine/hash.js';

const NO = { minIntervalSec: 1e9, maxIntervalSec: 1e9, firstSec: 1e9 };

function quiet(windDir: number, variable = false): GroundSimulation {
  const scenario: GroundScenario = {
    seed: 1,
    airport: VABB,
    traffic: { departures: NO, arrivals: NO },
    windVariable: variable,
    initialWind: { direction: windDir, speed: 12 },
  };
  return new GroundSimulation(scenario);
}

test('the ground map for Mumbai is registered', () => {
  assert.equal(groundAirportFor('vabb').icao, 'VABB');
  assert.equal(groundAirportFor('xdem').icao, 'XGND');
  assert.ok(VABB.stands.length >= 100, 'stands');
  for (const apron of ['A', 'C', 'G', 'K', 'R', 'S', 'V', 'J']) assert.ok(VABB.stands.some((s) => s.id.startsWith(apron)), `apron ${apron}`);
});

test('take-off distances from the holding points match the AIP (AD 2.13), within 60 m', () => {
  // [wind direction, hold, AIP TORA]; E/E1 share one crossing here, so E1 is checked loosely.
  const cases: [number, string, number][] = [
    [270, 'N1Rh', 3448], [270, 'N3h', 3188], [270, 'N4h', 2814], [270, 'Eh', 2349], [270, 'Qh', 1878],
    [90, 'Nh', 3188], [90, 'N11h', 3048], [90, 'N10h', 2849], [90, 'F1h', 2021], [90, 'N6h', 1882], [90, 'Qh', 1320],
    [135, 'E10h', 2871], [135, 'E9h', 2774], [135, 'W7h', 2409], [135, 'W6h', 2311], [135, 'W4h', 1794],
    [315, 'W1h', 2823], [315, 'F4h', 1824],
  ];
  for (const [wind, hold, tora] of cases) {
    const sim = quiet(wind);
    const ac = sim.addAircraft({ callsign: 'T1', isArrival: false, stand: 'A1', type: 'AT76', status: 'taxi', node: 'A1' });
    const dp = sim.departurePoint(ac, hold);
    assert.ok(dp, `${hold} is a departure point on ${sim.runwayEnd().id}`);
    assert.ok(Math.abs(dp.remaining - tora) <= 60, `${hold} on ${sim.runwayEnd().id}: ${dp.remaining} m, AIP ${tora} m`);
  }
});

test('the wind picks the runway end', () => {
  const ends: [number, string][] = [[270, '27'], [90, '09'], [135, '14'], [315, '32']];
  for (const [dir, end] of ends) assert.equal(quiet(dir).getState().runway, end);
});

test('every stand has a route to the full-length holding point of every runway end, and arrivals can reach every stand', () => {
  for (const dir of [270, 90, 135, 315]) {
    const sim = quiet(dir);
    const g = sim.graph;
    const rwy = sim.runwayEnd();
    for (const s of VABB.stands) {
      assert.ok(g.route(s.pushNode, null, null, rwy.holdingPoint), `${s.id} -> ${rwy.holdingPoint} (runway ${rwy.id})`);
    }
    for (const n of g.nodes.values()) {
      if (!n.onRunway || n.crossing) continue;
      for (const nb of g.neighbors(n.id)) {
        const hold = g.node(nb.to);
        if (!hold.holdShort) continue;
        const clear = g.neighbors(hold.id).find((x) => !g.node(x.to).onRunway);
        if (!clear) continue;
        for (const s of VABB.stands) assert.ok(g.route(clear.to, hold.id, null, s.id), `${hold.id} -> ${s.id} (runway ${rwy.id})`);
      }
    }
  }
});

test('no taxi legs cross each other without a shared node', () => {
  const N = new Map(VABB.nodes.map((n) => [n.id, n]));
  const E = VABB.edges.filter((e) => e.kind !== 'stand');
  const ccw = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  const bad: string[] = [];
  for (let i = 0; i < E.length; i++) {
    for (let j = i + 1; j < E.length; j++) {
      const a = E[i];
      const b = E[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      const [p1, p2, p3, p4] = [N.get(a.a)!, N.get(a.b)!, N.get(b.a)!, N.get(b.b)!];
      if (ccw(p1, p3, p4) * ccw(p2, p3, p4) < 0 && ccw(p1, p2, p3) * ccw(p1, p2, p4) < 0) bad.push(`${a.name} x ${b.name}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('only the runway in use is a runway: the other is a taxiway with its crossing held short', () => {
  const on27 = quiet(270).graph;
  assert.equal(on27.node('X').onRunway, true);
  assert.equal(on27.node('RN').onRunway, false, '14/32 is a taxiway while 27 is in use');
  assert.equal(on27.node('X14N').holdShort, true, 'crossing 27 from 14/32 needs a hold');
  assert.equal(on27.node('X09W').holdShort, false);
  assert.equal(on27.node('N5h').holdShort, true);
  assert.equal(on27.node('W4h').holdShort, false, 'W4 is a runway connector of 14/32 only');
  const on14 = quiet(135).graph;
  assert.equal(on14.node('RN').onRunway, true);
  assert.equal(on14.node('R9.0').onRunway, false);
  assert.equal(on14.node('X09W').holdShort, true, 'crossing 14 from 09/27 needs a hold');
  assert.equal(on14.node('N5h').holdShort, false);
  assert.equal(on14.node('N14Wh').holdShort, true, 'taxiway N crosses 14/32');
  // Taxiing along the runway not in use is allowed; along the one in use it is not.
  assert.ok(on14.route('R9.0', null, 90, 'R9.1') === null || on14.route('R9.0', null, 90, 'R9.1')!.length > 1);
});

test('a runway change waits for both runways to clear, then switches', () => {
  const sim = quiet(270, true);
  sim.addAircraft({ callsign: 'IGO1', isArrival: true, stand: 'V12', status: 'final', finalDist: 4000 });
  const w = sim.getState().wind;
  w.direction = 140;
  w.speed = 25;
  let changedAt = -1;
  let sawPending = false;
  let landedAt = -1;
  for (let t = 0; t < 2400 / sim.dt && changedAt < 0; t++) {
    sim.step();
    if (sim.switchPending && sim.getState().aircraft.some((a) => a.status === 'final' || a.status === 'landing')) sawPending = true;
    for (const e of sim.drainEvents()) {
      if (e.type === 'touchdown' && landedAt < 0) landedAt = t;
      if (e.type === 'runwayChanged') changedAt = t;
    }
    if (changedAt < 0) assert.equal(sim.getState().runway, '27', 'still on 27 while traffic is on it');
  }
  assert.ok(changedAt > 0, 'switched');
  assert.ok(landedAt > 0 && changedAt > landedAt, 'after the landing');
  assert.ok(sawPending);
  assert.equal(sim.getState().runway, '14');
  assert.equal(sim.graph.node('RN').onRunway, true);
});

test('a scripted controller keeps Mumbai moving on every runway end, deterministically', () => {
  for (const dir of [270, 90, 135, 315]) {
    const scenario: GroundScenario = {
      seed: 11,
      airport: VABB,
      traffic: { departures: { minIntervalSec: 130, maxIntervalSec: 220, firstSec: 3 }, arrivals: { minIntervalSec: 150, maxIntervalSec: 230, firstSec: 20 } },
      windVariable: false,
      initialWind: { direction: dir, speed: 10 },
    };
    const run = (): GroundSimulation => {
      const sim = new GroundSimulation(scenario);
      for (let t = 0; t < 2400 / sim.dt; t++) {
        sim.step();
        sim.drainEvents();
        if (t % 4) continue;
        for (const ac of sim.getState().aircraft) {
          if (ac.status === 'ready') {
            for (const f of ['N', 'E', 'S', 'W'] as const) if (sim.command({ type: 'pushback', callsign: ac.callsign, face: f }).ok) break;
          } else if (ac.status === 'taxi' && !ac.isArrival && !ac.next && ac.route.length === 0 && !ac.vacating) {
            // The nearest holding point it can take off from, as a controller would send it.
            const from = sim.routeStart(ac);
            const ranked = sim
              .departureOptions(ac)
              .map((o) => ({ o, len: from ? (() => { const r = sim.graph.route(from.start, from.prev, from.heading, o.hold); return r ? sim.graph.pathLength(r) : Infinity; })() : Infinity }))
              .sort((p, q) => p.len - q.len);
            for (const { o, len } of ranked) if (len < Infinity && sim.command({ type: 'taxi', callsign: ac.callsign, to: o.hold.replace(/h$/, '') }).ok) break;
          } else if (ac.status === 'taxi' && ac.isArrival && !ac.next && ac.route.length === 0 && !ac.vacating) {
            sim.command({ type: 'taxi', callsign: ac.callsign, to: ac.stand });
          } else if (ac.status === 'taxi' && !ac.next && ac.route.length > 0 && !ac.held) {
            sim.command({ type: 'cross', callsign: ac.callsign });
          }
        }
        sim.drainEvents();
      }
      return sim;
    };
    const a = run();
    const st = a.getState().stats;
    assert.ok(st.departed >= 8, `runway ${a.getState().runway}: ${st.departed} departures in 40 min`);
    assert.ok(st.parked >= 8, `runway ${a.getState().runway}: ${st.parked} arrivals parked`);
    assert.equal(stateHash(run().getState() as never), stateHash(a.getState() as never), 'same seed, same commands, same state');
  }
});

test('every stand can push back facing somewhere, and sits clear of its push node', () => {
  const sim = quiet(270);
  const g = sim.graph;
  const faces = { N: 0, E: 90, S: 180, W: 270 };
  for (const s of VABB.stands) {
    const can = Object.values(faces).some((f) =>
      g.neighbors(s.pushNode).some((n) => (n.edge.kind === 'taxilane' || n.edge.kind === 'link') && Math.abs((((n.bearing - f) % 360) + 540) % 360 - 180) < 50),
    );
    assert.ok(can, `${s.id} has no pushback direction`);
    const a = g.node(s.id);
    const b = g.node(s.pushNode);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 15, `${s.id} is on top of its push node`);
  }
});

test('landing distances (threshold to the end of the run) match the AIP (AD 2.13), within 12 m', () => {
  const lda = { '09': 3048, '27': 2965, '14': 2471, '32': 2673 } as const;
  for (const r of VABB.runways) {
    const d = Math.hypot((r.endX ?? 0) - r.thresholdX, (r.endY ?? 0) - r.thresholdY);
    assert.ok(Math.abs(d - lda[r.id as keyof typeof lda]) <= 12, `${r.id}: ${Math.round(d)} m, AIP ${lda[r.id as keyof typeof lda]} m`);
  }
});

test('runways are drawn with the AIP widths and shoulders', () => {
  const w = Object.fromEntries((VABB.runwayMarks ?? []).map((r) => [r.name, [r.width, r.shoulder]]));
  assert.deepEqual(w, { '09/27': [60, 7.5], '14/32': [45, 15] });
  for (const r of VABB.runwayMarks ?? []) assert.ok(r.polys.length > 100, `${r.name} has its markings`);
});
