import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from './stats.mjs';

test('computeStats returns null for no samples', () => {
  assert.equal(computeStats([]), null);
});

test('computeStats of a single sample is that sample', () => {
  assert.deepEqual(computeStats([42]), { min: 42, avg: 42, p95: 42 });
});

test('computeStats computes min, avg, and p95 over unsorted samples', () => {
  // 20 samples: 1..20 shuffled. p95 = 19th of 20 sorted values.
  const samples = [12, 3, 20, 7, 1, 16, 9, 14, 5, 18, 2, 11, 8, 19, 4, 15, 10, 6, 17, 13];
  const stats = computeStats(samples);
  assert.equal(stats.min, 1);
  assert.equal(stats.avg, 10.5);
  assert.equal(stats.p95, 19);
});
