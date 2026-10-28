import { expect, test } from 'vitest';
import { defaultIngestConcurrency, detectHardware, resolveIngestConcurrency } from './hardware.js';

test('default proporzionato ai core, fra 1 e 8', () => {
  expect(defaultIngestConcurrency(4)).toBe(2);
  expect(defaultIngestConcurrency(1)).toBe(1);
  expect(defaultIngestConcurrency(2)).toBe(1);
  expect(defaultIngestConcurrency(12)).toBe(6);
  expect(defaultIngestConcurrency(32)).toBe(8);
});

test('INGEST_CONCURRENCY esplicito ha la precedenza', () => {
  expect(resolveIngestConcurrency(3, { cores: 32 })).toBe(3);
  expect(resolveIngestConcurrency(undefined, { cores: 32 })).toBe(8);
});

test('rileva il profilo della macchina', () => {
  const hw = detectHardware();
  expect(hw.cores).toBeGreaterThanOrEqual(1);
  expect(hw.totalMemBytes).toBeGreaterThan(0);
});
