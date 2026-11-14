import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgePoint, cornerCut } from '../src/engine/ground/curve.js';

test('a rounded corner is continuous across the node and cuts inside it', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  const c = { x: 200, y: 200 };
  assert.ok(cornerCut(a, b, c) > 0);
  const end = edgePoint(null, a, b, c, 200); // at b on the first edge
  const start = edgePoint(a, b, c, null, 0); // at b on the second edge
  assert.ok(Math.hypot(end.x - start.x, end.y - start.y) < 1e-6);
  assert.ok(end.x < 200 && end.y > 0, 'inside the corner');
  assert.ok(Math.abs(end.heading - 45) < 1e-6, 'heading halfway through a 90 degree turn');
  // Straight stretches are untouched.
  const mid = edgePoint(null, a, b, c, 50);
  assert.deepEqual([mid.x, mid.y, Math.round(mid.heading)], [50, 0, 90]);
  // Straight-on and U-turns stay sharp.
  assert.equal(cornerCut(a, b, { x: 400, y: 0 }), 0);
  assert.equal(cornerCut(a, b, { x: 0, y: 1 }), 0);
});
