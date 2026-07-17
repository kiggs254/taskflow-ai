import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfLocalDayMs,
  endOfLocalDayMs,
  localDateString,
  localHourMinute,
  localMinutesOfDay,
  parseTimeToMinutes,
  isValidTimezone,
} from '../src/utils/time.js';

// 2026-07-16T09:12:00Z is 12:12 in Nairobi (UTC+3).
const T = Date.parse('2026-07-16T09:12:00Z');
const NBO = 'Africa/Nairobi';

test('localDateString / localHourMinute reflect the zone, not the server', () => {
  assert.equal(localDateString(NBO, T), '2026-07-16');
  assert.deepEqual(localHourMinute(NBO, T), { hour: 12, minute: 12 });
  assert.equal(localMinutesOfDay(NBO, T), 12 * 60 + 12);
});

test('local day boundaries are the real instants', () => {
  assert.equal(new Date(startOfLocalDayMs(NBO, T)).toISOString(), '2026-07-15T21:00:00.000Z');
  assert.equal(new Date(endOfLocalDayMs(NBO, T)).toISOString(), '2026-07-16T21:00:00.000Z');
  assert.equal(endOfLocalDayMs(NBO, T) - startOfLocalDayMs(NBO, T), 86_400_000);
});

test('day rolls over at local midnight, not UTC midnight', () => {
  assert.equal(localDateString(NBO, Date.parse('2026-07-16T20:59:00Z')), '2026-07-16');
  assert.equal(localDateString(NBO, Date.parse('2026-07-16T21:00:00Z')), '2026-07-17');
  // Intl can report hour 24 for midnight under hour12:false; we normalise to 0.
  assert.equal(localHourMinute(NBO, Date.parse('2026-07-16T21:00:00Z')).hour, 0);
});

test('startOfLocalDayMs is idempotent', () => {
  const a = startOfLocalDayMs(NBO, T);
  assert.equal(startOfLocalDayMs(NBO, a), a);
});

test('DST is handled (this is why we do not use a fixed offset)', () => {
  // US spring-forward: the local day is 23 hours long.
  const dst = Date.parse('2026-03-08T18:00:00Z');
  const len = (endOfLocalDayMs('America/New_York', dst) - startOfLocalDayMs('America/New_York', dst)) / 3_600_000;
  assert.equal(len, 23);
  assert.equal(localDateString('America/New_York', dst), '2026-03-08');
  assert.equal(new Date(startOfLocalDayMs('America/New_York', dst)).toISOString(), '2026-03-08T05:00:00.000Z');
});

test('UTC behaves', () => {
  assert.equal(localDateString('UTC', T), '2026-07-16');
  assert.equal(new Date(startOfLocalDayMs('UTC', T)).toISOString(), '2026-07-16T00:00:00.000Z');
});

test('parseTimeToMinutes returns null rather than defaulting to midnight', () => {
  assert.equal(parseTimeToMinutes('16:30'), 990);
  assert.equal(parseTimeToMinutes('16:30:00'), 990); // Postgres TIME
  assert.equal(parseTimeToMinutes('nope'), null);
  assert.equal(parseTimeToMinutes('25:00'), null);
  assert.equal(parseTimeToMinutes(undefined), null);
});

test('isValidTimezone guards user input before it reaches a cron sweep', () => {
  assert.equal(isValidTimezone(NBO), true);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
  assert.equal(isValidTimezone(''), false);
});
