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

/**
 * The morning-of-the-1st gate. Written against the same Intl call the job uses, so a
 * timezone mistake shows up here rather than as a month exported at 2am or not at all.
 */
const localHour = (tz, atMs) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(atMs));
const localDay = (tz, atMs) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(atMs).slice(8, 10));
const shouldExport = (tz, atMs, from = 6) =>
  !(localDay(tz, atMs) === 1 && localHour(tz, atMs) < from);

test('holds until the morning of the 1st, then exports', () => {
  // 1 Sep 02:00 Nairobi — too early.
  assert.equal(shouldExport('Africa/Nairobi', Date.UTC(2026, 8, 1, 0)), false);
  // 1 Sep 08:00 Nairobi — go.
  assert.equal(shouldExport('Africa/Nairobi', Date.UTC(2026, 8, 1, 5)), true);
});

test('a month missed entirely is still exported later, not lost', () => {
  // Container down all of the 1st: on the 3rd it must still fire.
  assert.equal(shouldExport('Africa/Nairobi', Date.UTC(2026, 8, 3, 1)), true);
});

test('the gate is evaluated in the user timezone', () => {
  // 31 Aug 22:00 UTC is already 1 Sep 01:00 in Nairobi — still too early there.
  const atMs = Date.UTC(2026, 7, 31, 22);
  assert.equal(localDay('Africa/Nairobi', atMs), 1);
  assert.equal(shouldExport('Africa/Nairobi', atMs), false, 'held: 1am local');
});
