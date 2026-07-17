import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The report window.
 *
 * Anchored to local midnight, work finished after the 16:30 send belonged to a day
 * whose report had already gone out, and the next day's report only looked at the next
 * day. Evening work fell into a 7.5-hour hole and appeared in no report at all -- not
 * deferred to tomorrow, dropped.
 *
 * Pure window arithmetic, mirroring getCompletedToday. The SQL side is verified
 * separately against real Postgres via PGlite; this pins the maths that decides which
 * report a given moment belongs to.
 */

const CLAMP_MS = 7 * 24 * 60 * 60 * 1000;

// Africa/Nairobi, UTC+3, no DST -- so a fixed offset is exact here.
const at = (day, hour, min = 0) => Date.UTC(2026, 6, day, hour - 3, min);
const midnightOf = (ms) => {
  const d = new Date(ms + 3 * 3600 * 1000);
  return Date.UTC(2026, 6, d.getUTCDate(), -3);
};

/** [start, end) of the report sent at `atMs`, given the previous send. */
const windowFor = (since, atMs) => [
  since ? Math.max(Number(since), atMs - CLAMP_MS) : midnightOf(atMs),
  atMs,
];
const inWindow = ([s, e], t) => t >= s && t < e;

const MON_1630 = at(13, 16, 30);
const MON_1900 = at(13, 19, 0);
const TUE_1630 = at(14, 16, 30);

test('work finished after the send lands in the next report, not nowhere', () => {
  const monday = windowFor(null, MON_1630);
  const tuesday = windowFor(MON_1630, TUE_1630);

  assert.equal(inWindow(monday, MON_1900), false, 'it had not happened by 16:30');
  assert.equal(inWindow(tuesday, MON_1900), true, 'so it belongs to the next report');
});

test('consecutive reports partition time exactly', () => {
  const monday = windowFor(null, MON_1630);
  const tuesday = windowFor(MON_1630, TUE_1630);

  assert.equal(monday[1], tuesday[0], 'no gap and no overlap between reports');

  // Every instant of Monday afternoon/evening belongs to exactly one report.
  for (let t = MON_1630 - 3600_000; t < TUE_1630; t += 20 * 60_000) {
    const n = [monday, tuesday].filter((w) => inWindow(w, t)).length;
    assert.equal(n, 1, `instant ${new Date(t).toISOString()} landed in ${n} reports`);
  }
});

test('the window ends at the send instant, not at local midnight', () => {
  // Midnight is in the FUTURE at 16:30, so a midnight-ended window overlaps the next
  // one by 7.5 hours. Nothing duplicates today only because a task cannot complete in
  // the future -- true, but not something the partition should rest on.
  const [, end] = windowFor(null, MON_1630);
  assert.equal(end, MON_1630);
  assert.ok(end < midnightOf(MON_1630) + 24 * 3600 * 1000);
});

test('a stale anchor clamps to 7 days rather than dumping the backlog', () => {
  // require_commits can keep an account quiet for weeks; its next report must not be a
  // month of history. Same trap the Slack scanner window clamp exists for.
  const [start] = windowFor(at(1, 0), TUE_1630);
  assert.equal(start, TUE_1630 - CLAMP_MS);
});

test('no anchor falls back to local midnight, not to the epoch', () => {
  const [start] = windowFor(null, MON_1630);
  assert.equal(start, midnightOf(MON_1630));
});

test('a fresh anchor is honoured over the clamp', () => {
  const [start] = windowFor(MON_1630, TUE_1630);
  assert.equal(start, MON_1630, 'only stale anchors clamp');
});
