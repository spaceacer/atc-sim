import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/commands/parser.js';

test('chained heading, altitude, speed', () => {
  const r = parseCommand('aal12 c 240 c 3 s 210');
  assert.deepEqual(r, {
    ok: true,
    callsign: 'AAL12',
    commands: [
      { type: 'heading', callsign: 'AAL12', heading: 240 },
      { type: 'altitude', callsign: 'AAL12', altitude: 3000 },
      { type: 'speed', callsign: 'AAL12', speed: 210 },
    ],
  });
});

test('forced turn, expedite, landing', () => {
  const r = parseCommand('BAW9 C 090 R C 12 EX L 27');
  assert.ok(r.ok);
  assert.deepEqual(r.commands, [
    { type: 'heading', callsign: 'BAW9', heading: 90, turn: 'R' },
    { type: 'altitude', callsign: 'BAW9', altitude: 12000, expedite: true },
    { type: 'land', callsign: 'BAW9', runway: '27' },
  ]);
});

test('"C 270 L 27" is a heading then a landing, not a left turn', () => {
  const r = parseCommand('DAL1 C 270 L 27');
  assert.ok(r.ok);
  assert.deepEqual(r.commands, [
    { type: 'heading', callsign: 'DAL1', heading: 270 },
    { type: 'land', callsign: 'DAL1', runway: '27' },
  ]);
  const left = parseCommand('DAL1 C 270 L');
  assert.ok(left.ok);
  assert.deepEqual(left.commands, [{ type: 'heading', callsign: 'DAL1', heading: 270, turn: 'L' }]);
});

test('helpful errors', () => {
  assert.equal(parseCommand('').ok, false);
  assert.equal(parseCommand('C 270').ok, false);
  assert.equal(parseCommand('AAL1 Q 5').ok, false);
  assert.equal(parseCommand('AAL1 C 400').ok, false);
  assert.equal(parseCommand('AAL1 S').ok, false);
});

test('direct-to, routes, line up and takeoff', () => {
  const r = parseCommand('igo451 c pune c 11 t');
  assert.ok(r.ok);
  assert.deepEqual(r.commands, [
    { type: 'direct', callsign: 'IGO451', fixes: ['PUNE'] },
    { type: 'altitude', callsign: 'IGO451', altitude: 11000 },
    { type: 'takeoff', callsign: 'IGO451' },
  ]);
  const route = parseCommand('AIC12 C OSKAR LOTAV S 220');
  assert.ok(route.ok);
  assert.deepEqual(route.commands, [
    { type: 'direct', callsign: 'AIC12', fixes: ['OSKAR', 'LOTAV'] },
    { type: 'speed', callsign: 'AIC12', speed: 220 },
  ]);
  const w = parseCommand('AKJ9 W 32');
  assert.ok(w.ok);
  assert.deepEqual(w.commands, [{ type: 'lineUp', callsign: 'AKJ9', runway: '32' }]);
});

test('heading 000, holds and go-around', () => {
  const zero = parseCommand('AIC1 C 000');
  assert.ok(zero.ok);
  assert.deepEqual(zero.commands, [{ type: 'heading', callsign: 'AIC1', heading: 0 }]);
  const h = parseCommand('AIC1 C 5 H OSKAR L');
  assert.ok(h.ok);
  assert.deepEqual(h.commands, [
    { type: 'altitude', callsign: 'AIC1', altitude: 5000 },
    { type: 'hold', callsign: 'AIC1', fix: 'OSKAR', turn: 'L' },
  ]);
  const here = parseCommand('AIC1 H');
  assert.ok(here.ok);
  assert.deepEqual(here.commands, [{ type: 'hold', callsign: 'AIC1' }]);
  const ga = parseCommand('AIC1 A');
  assert.ok(ga.ok);
  assert.deepEqual(ga.commands, [{ type: 'goAround', callsign: 'AIC1' }]);
});
