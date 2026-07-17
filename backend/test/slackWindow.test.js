import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The Slack scan window.
 *
 * Mirrors the computation in slackService.scanSlackMentions. It lives here because
 * getting it wrong is silent and expensive: the scheduled path previously sent no
 * `oldest` at all, so every run re-walked ~100 messages per channel and fanned out
 * to conversations.replies for every threaded parent — a permanent 429 storm.
 *
 * The 7-day floor is the part that actually matters. `last_scan_at` only advanced
 * when a task was created, so in production it is months stale; honouring it
 * literally would make the fix's own first run replay that history and reproduce
 * the incident.
 */

const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const scanWindowOldest = (lastScanAt, now) => {
  const floorMs = now - MAX_LOOKBACK_MS;
  const lastScanMs = lastScanAt ? new Date(lastScanAt).getTime() : 0;
  const windowStartMs = Math.max(lastScanMs || floorMs, floorMs);
  return Math.floor(windowStartMs / 1000);
};

const NOW = Date.parse('2026-07-17T12:00:00Z');
const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000;

test('a recent watermark is honoured as-is', () => {
  const lastScan = new Date(daysAgo(1)).toISOString();
  assert.equal(scanWindowOldest(lastScan, NOW), Math.floor(daysAgo(1) / 1000));
});

test('a months-stale watermark clamps to 7 days — this is the production case', () => {
  // Real value observed in production: ~4 months stale.
  const lastScan = new Date(daysAgo(120)).toISOString();
  assert.equal(scanWindowOldest(lastScan, NOW), Math.floor(daysAgo(7) / 1000));
});

test('a first-ever scan (no watermark) also clamps to 7 days, not the epoch', () => {
  // Without the floor this is `oldest: 0` — all history, every channel.
  assert.equal(scanWindowOldest(null, NOW), Math.floor(daysAgo(7) / 1000));
  assert.equal(scanWindowOldest(undefined, NOW), Math.floor(daysAgo(7) / 1000));
});

test('the window never reaches further back than 7 days, whatever the input', () => {
  for (const days of [0, 1, 6.9, 7, 8, 30, 365, 5000]) {
    const oldest = scanWindowOldest(new Date(daysAgo(days)).toISOString(), NOW);
    assert.ok(
      oldest >= Math.floor(daysAgo(7) / 1000),
      `lastScan ${days}d ago produced a window older than the 7-day floor`
    );
  }
});

test('oldest is Unix SECONDS, not milliseconds — Slack rejects ms', () => {
  const oldest = scanWindowOldest(new Date(daysAgo(1)).toISOString(), NOW);
  // ~1.78e9 for 2026; a ms value would be ~1.78e12.
  assert.ok(oldest < 1e11, `looks like milliseconds: ${oldest}`);
  assert.ok(oldest > 1e9);
});

/**
 * The watermark now advances on every successful scan rather than only when a task
 * was created. The old guard was hand-rolling at-least-once delivery that
 * processed_slack_messages already provides — and its real damage was to the cron
 * gate, which compares now - last_scan_at against scan_frequency. A frozen
 * watermark made that difference always huge, so a 15-minute setting ran every 60s.
 */
const OVERLAP_MS = 5 * 60 * 1000;
const nextWatermark = (scanStartedAt) => scanStartedAt - OVERLAP_MS;

test('watermark advances to scan start, with an overlap for mid-scan messages', () => {
  assert.equal(nextWatermark(NOW), NOW - OVERLAP_MS);
  assert.ok(nextWatermark(NOW) < NOW, 'must never be in the future');
});

test('an advancing watermark lets the frequency gate work again', () => {
  const minutesSince = (lastScan, now) => (now - lastScan) / 60000;
  const SCAN_FREQUENCY = 15;

  // After a scan, the next tick a minute later must be gated off.
  const justScanned = nextWatermark(NOW);
  assert.ok(minutesSince(justScanned, NOW + 60_000) < SCAN_FREQUENCY, 'should skip');

  // ...and allowed once the frequency has elapsed.
  assert.ok(minutesSince(justScanned, NOW + 16 * 60_000) >= SCAN_FREQUENCY, 'should run');

  // The frozen-watermark bug: 4 months stale always beats any frequency, so the
  // gate never fired and the scan ran every single minute.
  assert.ok(minutesSince(daysAgo(120), NOW) > SCAN_FREQUENCY);
});
