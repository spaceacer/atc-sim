// Usage counting must be safe to call anywhere and must bucket values into readable rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucket, minutesBucket, scoreBucket, track, initAnalytics } from '../src/ui/analytics.js';

test('bucket names the range a value falls in', () => {
  assert.equal(bucket(-30, [0, 50, 100]), 'under-0');
  assert.equal(bucket(0, [0, 50, 100]), '0-50');
  assert.equal(bucket(49, [0, 50, 100]), '0-50');
  assert.equal(bucket(50, [0, 50, 100]), '50-100');
  assert.equal(bucket(100, [0, 50, 100]), '100-plus');
});

test('minutes and score buckets', () => {
  assert.equal(minutesBucket(30_000), 'under-1min');
  assert.equal(minutesBucket(10 * 60_000), '5-15min');
  assert.equal(minutesBucket(2 * 3_600_000), '60min-plus');
  assert.equal(scoreBucket(-40), 'under-0');
  assert.equal(scoreBucket(120), '100-200');
});

test('tracking does nothing, and never throws, without a browser or a GoatCounter code', () => {
  assert.doesNotThrow(() => initAnalytics());
  assert.doesNotThrow(() => track('start/vabb/approach/standard'));
});
