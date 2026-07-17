import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateAtWord } from '../src/utils/text.js';
import { localDayOfWeek, isWeekend } from '../src/utils/time.js';

/**
 * Presentation of the daily report.
 *
 * buildDailySummaryMessage is imported lazily inside the tests that need it: importing
 * slackService pulls in the whole AI/db chain at module load.
 */

test('truncateAtWord never cuts a word in half', () => {
  // The real regression: slice(0, 70) rendered "…renamed plans, added showroom s",
  // which reads as corrupted output rather than as an abbreviation.
  const s = 'Fixed checkout delivery date dead-end, renamed plans, added showrooms and seeds';
  const out = truncateAtWord(s, 70);
  assert.ok(out.length <= 70, `got ${out.length} chars`);
  assert.ok(out.endsWith('…'), 'the ellipsis is what marks it as abbreviated');
  assert.ok(!out.includes('showroom s'), 'must not split a word');
  // Every word kept must be a whole word from the original.
  for (const w of out.replace(/…$/, '').trim().split(/\s+/)) {
    assert.ok(s.split(/\s+/).includes(w), `"${w}" is not a whole word from the input`);
  }
});

test('truncateAtWord leaves short strings completely alone', () => {
  assert.equal(truncateAtWord('Add CSV export', 70), 'Add CSV export');
});

test('truncateAtWord falls back to a hard cut on one long token', () => {
  // No boundary to find; better a hard cut than returning the whole thing and busting
  // a Slack block limit.
  const out = truncateAtWord('a'.repeat(200), 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith('…'));
});

test('truncateAtWord does not leave dangling punctuation before the ellipsis', () => {
  assert.ok(!/[,\-–—]…$/.test(truncateAtWord('Fixed the checkout flow, renamed the plans', 26)));
});

test('the report skips Saturday and Sunday in the USER timezone, not the servers', async () => {
  // A UTC server is still on Friday when Nairobi has ticked into Saturday. The report
  // fires at 16:30 local, so getting this from the host clock would be wrong for
  // three hours every night.
  const satMorningNairobi = Date.UTC(2026, 6, 18, 3, 0); // Sat 06:00 EAT / Fri 22:00 UTC? no: 03:00 UTC = 06:00 EAT Sat
  assert.equal(localDayOfWeek('Africa/Nairobi', satMorningNairobi), 6, 'Saturday');
  assert.equal(isWeekend('Africa/Nairobi', satMorningNairobi), true);

  // Friday 23:00 UTC is already Saturday 02:00 in Nairobi.
  const fridayLateUtc = Date.UTC(2026, 6, 17, 23, 0);
  assert.equal(isWeekend('UTC', fridayLateUtc), false, 'still Friday in UTC');
  assert.equal(isWeekend('Africa/Nairobi', fridayLateUtc), true, 'already Saturday in Nairobi');
});

test('weekdays are not skipped', () => {
  const fri = Date.UTC(2026, 6, 17, 13, 30); // Fri 16:30 EAT
  const mon = Date.UTC(2026, 6, 20, 13, 30); // Mon 16:30 EAT
  assert.equal(isWeekend('Africa/Nairobi', fri), false);
  assert.equal(isWeekend('Africa/Nairobi', mon), false);
  assert.equal(localDayOfWeek('Africa/Nairobi', mon), 1, 'Monday');
});

test('a subtask that merely restates the task title is dropped', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  // Exactly what a fallback summary produced: the one line became the title AND its
  // only subtask, so the reader saw the same sentence twice with a tick next to it.
  const { blocks } = buildDailySummaryMessage('Newton', [
    {
      title: 'Payment-plan-application-form — updated 2 files',
      subtasks: [{ title: 'Payment-plan-application-form — updated 2 files', completed: true }],
    },
  ], '2026-07-17');

  const section = blocks.find((b) => b.type === 'section');
  const occurrences = section.text.text.split('updated 2 files').length - 1;
  assert.equal(occurrences, 1, 'the same sentence must not appear twice');
});

test('the project is separated from the outcome so a scan reads as a list of projects', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const { blocks } = buildDailySummaryMessage('Newton', [
    { title: 'hotpoint-front — Fixed the checkout dead-end', subtasks: [{ title: 'fix(checkout): stale date', completed: true }] },
  ], '2026-07-17');

  const section = blocks.find((b) => b.type === 'section');
  assert.ok(section.text.text.startsWith('*hotpoint-front*'), 'project is the bold anchor');
  assert.ok(section.text.text.includes('Fixed the checkout dead-end'), 'outcome reads as prose beneath it');
});

test('long subtask lists are capped and the remainder is disclosed, not silently dropped', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const subtasks = Array.from({ length: 14 }, (_, i) => ({ title: `Commit number ${i}`, completed: true }));
  const { blocks } = buildDailySummaryMessage('Newton', [{ title: 'taskflow-ai — Lots', subtasks }], '2026-07-17');

  const section = blocks.find((b) => b.type === 'section');
  assert.ok(section.text.text.includes('and 6 more'), 'the reader must be told what was hidden');
});

test('the message stays inside Slacks 50-block cap', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  // Over the cap Slack rejects the whole post, so the report would silently vanish.
  const tasks = Array.from({ length: 40 }, (_, i) => ({
    title: `project-${i} — did things`,
    subtasks: [{ title: 'a thing', completed: true }],
  }));
  const { blocks, text } = buildDailySummaryMessage('Newton', tasks, '2026-07-17');
  assert.ok(blocks.length <= 50, `got ${blocks.length} blocks`);
  assert.ok(text.length > 0, 'the notification fallback must never be empty');
});

test('every section stays inside Slacks 3000-char per-section limit', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const subtasks = Array.from({ length: 8 }, () => ({ title: 'x'.repeat(300), completed: true }));
  const { blocks } = buildDailySummaryMessage('Newton', [{ title: 'big — one', subtasks }], '2026-07-17');
  for (const b of blocks.filter((x) => x.type === 'section')) {
    assert.ok(b.text.text.length <= 3000, `section is ${b.text.text.length} chars`);
  }
});

test('the header is plain_text, since Slack renders no mrkdwn there', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const { blocks } = buildDailySummaryMessage('Newton', [{ title: 'a — b', subtasks: [] }], '2026-07-17');
  const header = blocks.find((b) => b.type === 'header');
  assert.equal(header.text.type, 'plain_text');
  assert.ok(!header.text.text.includes('*'), 'a literal asterisk would be shown to the user');
});

test('identifiers with underscores are not wrapped in Slack italics markup', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  // Slack mrkdwn has no escape character. Wrapping an outcome in _italics_ when the
  // outcome itself contains AI_PRIMARY_PROVIDER or migrate_all.sql hands the parser
  // four underscores to pair up, and it renders something nobody wrote.
  const { blocks } = buildDailySummaryMessage('Newton', [
    {
      title: 'taskflow-ai — Fix repo list, and honour AI_PRIMARY_PROVIDER',
      subtasks: [{ title: 'Add consolidated migrate_all.sql', completed: true }],
    },
  ], '2026-07-17');

  const body = blocks.find((b) => b.type === 'section').text.text;
  assert.ok(body.includes('AI_PRIMARY_PROVIDER'), 'the identifier survives intact');
  assert.ok(body.includes('migrate_all.sql'), 'the filename survives intact');
  assert.ok(!/_Fix repo list/.test(body), 'the outcome must not be wrapped in italics markup');
});
