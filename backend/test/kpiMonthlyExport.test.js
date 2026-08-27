import test from 'node:test';
import assert from 'node:assert/strict';
import { previousMonth } from '../src/jobs/kpiMonthlyExport.js';

test('previousMonth rolls back across a year boundary', () => {
  // 1 Jan must export December of the PREVIOUS year, not month 0 of this one.
  assert.equal(previousMonth('Africa/Nairobi', Date.UTC(2027, 0, 1, 6)), '2026-12');
});

test('previousMonth is the month just ended, all month long', () => {
  assert.equal(previousMonth('Africa/Nairobi', Date.UTC(2026, 7, 1, 6)), '2026-07');
  assert.equal(previousMonth('Africa/Nairobi', Date.UTC(2026, 7, 28, 6)), '2026-07');
});

test('previousMonth uses the user timezone, not the host clock', () => {
  // 31 Jul 22:00 UTC is already 1 Aug in Nairobi (+3), so Nairobi has rolled over to
  // exporting July while UTC would still be mid-June's reckoning.
  const atMs = Date.UTC(2026, 6, 31, 22);
  assert.equal(previousMonth('Africa/Nairobi', atMs), '2026-07');
  assert.equal(previousMonth('UTC', atMs), '2026-06');
});
