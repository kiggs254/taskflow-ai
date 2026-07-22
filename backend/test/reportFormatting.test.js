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

test('the project shows a narrative paragraph, not a checklist of raw commits', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const { blocks } = buildDailySummaryMessage('Newton', [
    {
      title: 'hotpoint-front — WhatsApp orders and checkout fixes',
      project: 'hotpoint-front',
      narrative: 'Wired up paid WhatsApp orders and steadied the checkout and stock flows.',
      subtasks: [
        { title: 'feat(orders): receive paid WhatsApp orders over the partner API', completed: true },
        { title: 'fix(checkout): stop Shopify availableForSale blocking orders', completed: true },
      ],
    },
  ], '2026-07-22');

  const body = blocks.find((b) => b.type === 'section').text.text;
  assert.ok(body.startsWith('*hotpoint-front*'), 'project is the bold anchor');
  assert.ok(body.includes('Wired up paid WhatsApp orders'), 'the narrative is shown');
  assert.ok(!body.includes('feat(orders)'), 'raw commit subjects are not listed');
  assert.ok(!body.includes('✅') && !body.includes('✓'), 'no checkmarks');
});

test('with no narrative it falls back to the title outcome rather than showing commits', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  const { blocks } = buildDailySummaryMessage('Newton', [
    { title: 'hotpoint-front — Fixed the checkout dead-end', subtasks: [{ title: 'fix(checkout): x', completed: true }] },
  ], '2026-07-17');

  const body = blocks.find((b) => b.type === 'section').text.text;
  assert.ok(body.startsWith('*hotpoint-front*'));
  assert.ok(body.includes('Fixed the checkout dead-end'), 'outcome stands in for a missing narrative');
  assert.ok(!body.includes('fix(checkout)'), 'still no raw commits');
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
  const { blocks } = buildDailySummaryMessage('Newton', [
    { title: 'big — one', project: 'big', narrative: 'x'.repeat(4000), subtasks: [] },
  ], '2026-07-17');
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

test('a narrative with underscores is not wrapped in Slack italics markup', async () => {
  const { buildDailySummaryMessage } = await import('../src/services/slackService.js');
  // Slack mrkdwn has no escape character. Wrapping a narrative in _italics_ when it
  // contains AI_PRIMARY_PROVIDER or migrate_all.sql hands the parser four underscores
  // to pair up, and it renders something nobody wrote. Only the project name (ours) is
  // marked up.
  const { blocks } = buildDailySummaryMessage('Newton', [
    {
      title: 'taskflow-ai — infra work',
      project: 'taskflow-ai',
      narrative: 'Fixed the repo list and made the app honour AI_PRIMARY_PROVIDER; added migrate_all.sql.',
      subtasks: [],
    },
  ], '2026-07-17');

  const body = blocks.find((b) => b.type === 'section').text.text;
  assert.ok(body.includes('AI_PRIMARY_PROVIDER'), 'the identifier survives intact');
  assert.ok(body.includes('migrate_all.sql'), 'the filename survives intact');
  assert.ok(!/\n_/.test(body), 'the narrative line must not open with italics markup');
});
