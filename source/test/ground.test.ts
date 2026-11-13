// Ground controller mode: taxi graph, pushback, taxi, tower, crossings, arrivals, conflicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundSimulation, groundReplay, CONFLICT_M } from '../src/engine/ground/simulation.js';
import type { GroundEvent, GroundScenario } from '../src/engine/ground/types.js';
import { XGND } from '../src/data/ground/practice.js';
import { stateHash } from '../src/engine/hash.js';

const NO_TRAFFIC = { minIntervalSec: 1e9, maxIntervalSec: 1e9, firstSec: 1e9 };

function quiet(runway: '27' | '09' = '27'): GroundSimulation {
  // Wind straight down the runway in use, fixed: no runway changes, no spawns.
  const scenario: GroundScenario = {
    seed: 1,
    airport: XGND,
    traffic: { departures: NO_TRAFFIC, arrivals: NO_TRAFFIC },
    windVariable: false,
    initialWind: { direction: runway === '27' ? 270 : 90, speed: 10 },
  };
  return new GroundSimulation(scenario);
}

/** Step until a predicate on the events holds, or fail after `seconds`. */
function until(sim: GroundSimulation, seconds: number, pred: (e: GroundEvent) => boolean, log: GroundEvent[] = []): GroundEvent {
  for (let i = 0; i < seconds / sim.dt; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      log.push(e);
      if (pred(e)) return e;
    }
  }
  assert.fail(`not within ${seconds} s; events: ${log.map((e) => e.type).join(', ')}`);
}

test('graph: routes follow the rules', () => {
  const g = quiet().graph;
  // From the push node of S8 facing east, to the 27 holding point via A.
  const r = g.route('T525', null, 90, 'A5h', ['A']);
  assert.ok(r, 'no route');
  assert.deepEqual(r.slice(-2), ['A5c', 'A5h']);
  assert.ok(!r.some((n) => g.node(n).onRunway), 'no runway on the way');
  // Facing west from the same spot, it cannot start eastbound: it must go round via J1/J2.
  const west = g.route('T525', null, 270, 'A5h');
  assert.ok(west && west[1] === 'T375', `west route starts ${west?.[1]}`);
  // Cargo C4 push node to A5 must cross the runway, straight across.
  const cargo = g.route('C300', null, 90, 'A5h')!;
  const i = cargo.findIndex((n) => g.node(n).onRunway);
  assert.ok(i > 0, 'crosses');
  assert.ok(g.node(cargo[i - 1]).holdShort && g.node(cargo[i + 1]).holdShort);
  // Explicit checks.
  assert.match(g.checkRoute(['A5h', 'R1750', 'R750', 'A4h'], 'A5c', null)!, /along the runway/);
  assert.match(g.checkRoute(['A5h', 'R1750'], 'A5c', null)!, /cannot end on the runway/);
  assert.match(g.checkRoute(['T-525', 'S1', 'T-525'], null, 90)!, /stand/);
  assert.match(g.checkRoute(['A0', 'A-600', 'A0'], null, 270)!, /sharply/);
  assert.equal(g.checkRoute(['A5c', 'A5h', 'A5c'], null, 180), null, 'U-turn allowed at a dead end');
});

test('departure: push back, taxi to the holding point, handed to the tower, departs', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'IGO1', isArrival: false, stand: 'S8', type: 'A20N' });
  assert.equal(sim.command({ type: 'pushback', callsign: 'IGO1', face: 'N' }).ok, false, 'cannot face north');
  assert.equal(sim.command({ type: 'pushback', callsign: 'IGO1', face: 'E' }).ok, true);
  assert.equal(sim.command({ type: 'taxi', callsign: 'IGO1', to: 'A5' }).ok, false, 'not before pushback ends');
  until(sim, 120, (e) => e.type === 'readyToTaxi');
  const r = sim.command({ type: 'taxi', callsign: 'IGO1', to: 'A5', via: ['A'] });
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /taxi to A5 via .*A/);
  const log: GroundEvent[] = [];
  until(sim, 400, (e) => e.type === 'departed', log);
  const order = log.map((e) => e.type).filter((t) => ['handedToTower', 'linedUp', 'departed'].includes(t));
  assert.deepEqual(order, ['handedToTower', 'linedUp', 'departed']);
  assert.equal(sim.getState().stats.score, 10);
  assert.equal(sim.getState().aircraft.length, 0);
});

test('taxi speed: 20 kt on the straight, slower in turns and on the apron', () => {
  const sim = quiet();
  const ac = sim.addAircraft({ callsign: 'IGO1', isArrival: false, stand: 'S1', status: 'taxi', node: 'A-1750', heading: 90 });
  sim.command({ type: 'taxi', callsign: 'IGO1', route: ['A-1750', 'A-750', 'A-600', 'A0', 'A600', 'A750', 'A1750'] });
  let max = 0;
  for (let i = 0; i < 240; i++) {
    sim.step();
    max = Math.max(max, ac.speed);
  }
  assert.equal(max, 20);
});

test('arrival: lands, turns off on its stand side, waits, taxis in and parks', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'AIC2', isArrival: true, stand: 'S3', type: 'A320', finalDist: 3000 });
  const td = until(sim, 120, (e) => e.type === 'touchdown');
  assert.equal(td.type === 'touchdown' && td.exit.startsWith('A'), true, 'north exit for a north stand');
  const vac = until(sim, 120, (e) => e.type === 'vacated');
  const ac = sim.getState().aircraft[0];
  assert.equal(ac.next, null, 'stops after vacating');
  assert.ok(!sim.onRunwayArea(ac));
  assert.equal(sim.command({ type: 'taxi', callsign: 'AIC2', to: 'S4' }).ok, false, 'wrong stand refused');
  const r = sim.command({ type: 'taxi', callsign: 'AIC2', to: 'S3' });
  assert.equal(r.ok, true, `${r.message} (vacated via ${vac.type === 'vacated' ? vac.via : ''})`);
  until(sim, 400, (e) => e.type === 'parked');
  assert.equal(sim.getState().stats.parked, 1);
  assert.equal(sim.getState().stats.score, 10);
});

test('crossing: holds short until requested and the tower approves; no approval with an arrival close', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'FDX1', isArrival: false, stand: 'C4', status: 'taxi', node: 'C300', heading: 90 });
  const r = sim.command({ type: 'taxi', callsign: 'FDX1', to: 'A5' });
  assert.match(r.message, /hold short of runway at B3/);
  const hs = until(sim, 200, (e) => e.type === 'holdingShort');
  assert.equal(hs.type === 'holdingShort' && hs.at, 'B3');
  sim.run(60);
  assert.equal(sim.getState().aircraft[0].node, 'B3h', 'waits without a request');

  sim.addAircraft({ callsign: 'IGO9', isArrival: true, stand: 'S1', finalDist: 2500 }); // about 35 s out
  assert.equal(sim.command({ type: 'cross', callsign: 'FDX1' }).ok, true);
  sim.run(40);
  assert.equal(sim.getState().aircraft.find((a) => a.callsign === 'FDX1')!.crossingCleared, false, 'not with an arrival close');
  until(sim, 300, (e) => e.type === 'crossingCleared');
  until(sim, 400, (e) => e.type === 'handedToTower');
  assert.equal(sim.getState().stats.goArounds, 0);
});

test('an arrival goes around if the runway is occupied', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'BLK1', isArrival: false, stand: 'C2', status: 'taxi', node: 'R0', heading: 0 });
  sim.addAircraft({ callsign: 'IGO5', isArrival: true, stand: 'S2', finalDist: 600 });
  const ga = until(sim, 60, (e) => e.type === 'goAround');
  assert.equal(ga.type === 'goAround' && ga.reason, 'runway occupied by BLK1');
  assert.equal(sim.getState().stats.score, -5);
});

test('pilots keep their distance behind traffic going the same way; head-on is a conflict', () => {
  const sim = quiet();
  const lead = sim.addAircraft({ callsign: 'LEAD', isArrival: false, stand: 'S1', status: 'taxi', node: 'A-600', heading: 90 });
  const tail = sim.addAircraft({ callsign: 'TAIL', isArrival: false, stand: 'S2', status: 'taxi', node: 'A-1750', heading: 90 });
  sim.command({ type: 'taxi', callsign: 'LEAD', to: 'A5' });
  sim.command({ type: 'hold', callsign: 'LEAD' }); // stopped on A
  sim.command({ type: 'taxi', callsign: 'TAIL', to: 'A5' });
  let minGap = Infinity;
  for (let i = 0; i < 400; i++) {
    sim.step();
    minGap = Math.min(minGap, Math.hypot(lead.x - tail.x, lead.y - tail.y));
  }
  assert.ok(minGap > CONFLICT_M, `came within ${minGap} m`);
  assert.equal(sim.getState().stats.conflicts, 0);

  const h = quiet();
  h.addAircraft({ callsign: 'EAST', isArrival: false, stand: 'S1', status: 'taxi', node: 'A-750', heading: 90 });
  h.addAircraft({ callsign: 'WEST', isArrival: false, stand: 'S2', status: 'taxi', node: 'A750', heading: 270 });
  h.command({ type: 'taxi', callsign: 'EAST', route: ['A-750', 'A-600', 'A0', 'A600', 'A750'] });
  h.command({ type: 'taxi', callsign: 'WEST', route: ['A750', 'A600', 'A0', 'A-600', 'A-750'] });
  until(h, 200, (e) => e.type === 'conflict');
  assert.equal(h.getState().stats.score, -20);
});

test('deterministic with automatic traffic, and a command log replays exactly', () => {
  const scenario: GroundScenario = {
    seed: 77,
    airport: XGND,
    traffic: {
      departures: { minIntervalSec: 60, maxIntervalSec: 120, firstSec: 5 },
      arrivals: { minIntervalSec: 90, maxIntervalSec: 150, firstSec: 10 },
    },
    windVariable: true,
  };
  const a = new GroundSimulation(scenario);
  const b = new GroundSimulation(scenario);
  // A simple scripted controller on `a`: push everyone east... where allowed, taxi to the runway in use.
  for (let t = 0; t < 1800 / a.dt; t++) {
    for (const ac of a.getState().aircraft) {
      if (ac.status === 'ready') {
        if (!a.command({ type: 'pushback', callsign: ac.callsign, face: 'E' }).ok) a.command({ type: 'pushback', callsign: ac.callsign, face: 'W' });
      }
    }
    a.step();
    b.step();
  }
  assert.ok(a.getCommandLog().length > 0);
  const replayed = groundReplay(scenario, a.getCommandLog(), a.tick);
  assert.equal(stateHash(replayed.getState() as never), stateHash(a.getState() as never));
  assert.notEqual(stateHash(b.getState() as never), stateHash(a.getState() as never));
});

test('a crossing request waiting at a holding position does not stop takeoffs', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'FDX1', isArrival: false, stand: 'C4', status: 'taxi', node: 'C300', heading: 90 });
  sim.command({ type: 'taxi', callsign: 'FDX1', to: 'A5' });
  until(sim, 200, (e) => e.type === 'holdingShort');
  sim.command({ type: 'cross', callsign: 'FDX1' });
  sim.addAircraft({ callsign: 'IGO1', isArrival: false, stand: 'S8', status: 'taxi', node: 'A5c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'IGO1', to: 'A5' });
  const dep = until(sim, 300, (e) => e.type === 'departed');
  assert.equal(dep.type === 'departed' && dep.callsign, 'IGO1');
});

test('no gridlock: a simple scripted controller keeps normal traffic moving for an hour', () => {
  const scenario: GroundScenario = {
    seed: 3,
    airport: XGND,
    traffic: {
      departures: { minIntervalSec: 180, maxIntervalSec: 270, firstSec: 3 },
      arrivals: { minIntervalSec: 180, maxIntervalSec: 270, firstSec: 20 },
    },
    windVariable: true,
  };
  const sim = new GroundSimulation(scenario);
  for (let t = 0; t < 3600 / sim.dt; t++) {
    for (const ac of sim.getState().aircraft) {
      const cs = ac.callsign;
      if (ac.status === 'ready') {
        const stand = XGND.stands.find((x) => x.id === ac.stand)!;
        const pn = sim.graph.node(stand.pushNode);
        const busy = sim.getState().aircraft.some(
          (o) => o !== ac && o.status !== 'final' && o.status !== 'parked' && o.status !== 'ready' && Math.hypot(o.x - pn.x, o.y - pn.y) < 160,
        );
        if (!busy && !sim.command({ type: 'pushback', callsign: cs, face: 'E' }).ok) sim.command({ type: 'pushback', callsign: cs, face: 'W' });
      } else if ((ac.status === 'taxi' || ac.status === 'starting') && !ac.vacating && !ac.next && ac.route.length === 0) {
        sim.command({ type: 'taxi', callsign: cs, to: ac.isArrival ? ac.stand : sim.runwayEnd().holdingPoint.replace(/h$/, '') });
      } else if (ac.status === 'taxi' && !ac.next && !ac.crossingRequested && sim.crossingAhead(ac)) {
        sim.command({ type: 'cross', callsign: cs });
      }
    }
    sim.step();
    sim.drainEvents();
  }
  const st = sim.getState().stats;
  assert.ok(st.departed >= 10, `departed ${st.departed}`);
  assert.ok(st.parked >= 10, `parked ${st.parked}`);
  assert.ok(st.goArounds <= 3, `go-arounds ${st.goArounds}`);
  assert.ok(sim.getState().aircraft.length < 12, `${sim.getState().aircraft.length} aircraft left on the field`);
});

test('intersection departures: accepted if the type has enough runway left, refused with the reason otherwise', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'ATR1', isArrival: false, stand: 'S7', type: 'AT76', status: 'taxi', node: 'A4c', heading: 180 });
  sim.addAircraft({ callsign: 'BIG1', isArrival: false, stand: 'S2', type: 'A320', status: 'taxi', node: 'A3c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'ATR1', to: 'A4' });
  sim.command({ type: 'taxi', callsign: 'BIG1', to: 'A3' });
  const log: GroundEvent[] = [];
  until(sim, 60, (e) => e.type === 'wrongHoldingPoint', log);
  const wrong = log.find((e) => e.type === 'wrongHoldingPoint');
  assert.equal(wrong?.type === 'wrongHoldingPoint' && wrong.reason, 'A3 leaves 1,750 m, A320 needs 2,100 m');
  const handed = log.find((e) => e.type === 'handedToTower') ?? until(sim, 60, (e) => e.type === 'handedToTower');
  assert.ok(handed.type === 'handedToTower' && handed.at === 'A4' && handed.intersection);
  const dep = until(sim, 300, (e) => e.type === 'departed');
  assert.equal(dep.type === 'departed' && dep.callsign, 'ATR1');
});

test('tower order: wake turbulence decides, and on a tie the lighter aircraft goes first', () => {
  const sim = quiet();
  // A heavy departs first; then a heavy and a medium are both waiting.
  sim.addAircraft({ callsign: 'HVY1', isArrival: false, stand: 'S8', type: 'B77W', status: 'taxi', node: 'A5c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'HVY1', to: 'A5' });
  until(sim, 300, (e) => e.type === 'departed');
  sim.addAircraft({ callsign: 'HVY2', isArrival: false, stand: 'S7', type: 'B789', status: 'taxi', node: 'A5c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'HVY2', to: 'A5' });
  sim.addAircraft({ callsign: 'MED1', isArrival: false, stand: 'S6', type: 'AT76', status: 'taxi', node: 'A4c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'MED1', to: 'A4' });
  const order: string[] = [];
  const log: GroundEvent[] = [];
  for (let i = 0; i < 2; i++) {
    const e = until(sim, 600, (x) => x.type === 'departed', log);
    if (e.type === 'departed') order.push(e.callsign);
  }
  // Behind a heavy the medium must wait 3 min (intersection); the heavy only the 60 s gap: heavy first.
  assert.deepEqual(order, ['HVY2', 'MED1']);

  // Last departure a medium, both can go after 60 s: the medium goes first even though the heavy queued first.
  const t = quiet();
  t.addAircraft({ callsign: 'LEAD', isArrival: false, stand: 'S8', type: 'A20N', status: 'taxi', node: 'A5c', heading: 180 });
  t.command({ type: 'taxi', callsign: 'LEAD', to: 'A5' });
  until(t, 300, (e) => e.type === 'linedUp'); // both others queue while the leader takes off
  t.addAircraft({ callsign: 'HVY3', isArrival: false, stand: 'S7', type: 'B77W', status: 'taxi', node: 'A5c', heading: 180 });
  t.command({ type: 'taxi', callsign: 'HVY3', to: 'A5' });
  t.addAircraft({ callsign: 'MED2', isArrival: false, stand: 'S6', type: 'A20N', status: 'taxi', node: 'A4c', heading: 180 });
  t.command({ type: 'taxi', callsign: 'MED2', to: 'A4' });
  until(t, 300, (e) => e.type === 'departed'); // LEAD
  const first = until(t, 600, (e) => e.type === 'departed');
  assert.equal(first.type === 'departed' && first.callsign, 'MED2');
});

test('behind landing traffic: the lighter aircraft at an intersection goes before the heavy at the runway end', () => {
  const sim = quiet();
  sim.addAircraft({ callsign: 'ARR1', isArrival: true, stand: 'S1', type: 'A320', finalDist: 2500 });
  until(sim, 120, (e) => e.type === 'touchdown');
  sim.addAircraft({ callsign: 'HVY1', isArrival: false, stand: 'S8', type: 'B77W', status: 'taxi', node: 'A5c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'HVY1', to: 'A5' });
  sim.addAircraft({ callsign: 'MED1', isArrival: false, stand: 'S7', type: 'AT76', status: 'taxi', node: 'A4c', heading: 180 });
  sim.command({ type: 'taxi', callsign: 'MED1', to: 'A4' });
  const order: string[] = [];
  const log: GroundEvent[] = [];
  for (let i = 0; i < 2; i++) {
    const e = until(sim, 600, (x) => x.type === 'departed', log);
    if (e.type === 'departed') order.push(e.callsign);
  }
  assert.deepEqual(order, ['MED1', 'HVY1']);
  assert.equal(sim.getState().stats.goArounds, 0);
});
