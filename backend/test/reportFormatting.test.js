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

/**
 * Manually logged work (LogWorkModal).
 *
 * The modal stores `${project} — ${outcome}` because that is the shape the report
 * reads back: splitProjectTitle cuts on " — ", and narrateItem's no-subtasks path
 * returns the outcome unchanged. That means what the user types is exactly what the
 * channel reads -- no AI call, nothing invented. If this separator ever drifts, the
 * project name silently becomes part of the sentence.
 */
test('a manually logged title splits into the project and the line beneath it', async () => {
  // Lazily imported for the same reason as buildDailySummaryMessage above: reportService
  // pulls in the AI/db chain at module load.
  const { splitProjectTitle } = await import('../src/services/reportService.js');
  const title = 'Hotpoint — Restored the staging database and reran the failed imports.';
  const { project, outcome } = splitProjectTitle(title);
  assert.equal(project, 'Hotpoint');
  assert.equal(outcome, 'Restored the staging database and reran the failed imports.');
});

test('a manual entry with no project keeps its whole sentence', async () => {
  const { splitProjectTitle } = await import('../src/services/reportService.js');
  const { project, outcome } = splitProjectTitle('Walked the client through the new checkout flow.');
  assert.equal(project, 'Walked the client through the new checkout flow.');
  assert.equal(outcome, '', 'no separator means nothing to split, not a truncated line');
});

test('an em dash inside the outcome does not re-split the title', async () => {
  const { splitProjectTitle } = await import('../src/services/reportService.js');
  const { project, outcome } = splitProjectTitle('Enkor — Fixed the import — twice.');
  assert.equal(project, 'Enkor', 'only the FIRST separator divides project from outcome');
  assert.equal(outcome, 'Fixed the import — twice.');
});

/**
 * Hand-written corrections to the report.
 *
 * Both halves of a report line are generated — the heading from the task title, the
 * paragraph by AI — and both are regenerated: a GitHub or agent task is rebuilt by
 * syncTask on every scan, and End Day Reset passes refresh:true to rewrite narratives.
 * So an edit is stored in override columns nothing regenerates, and attachNarratives
 * must prefer them over anything it would otherwise derive, INCLUDING under refresh.
 *
 * These pass no database and no API key, which is itself the assertion: an item carrying
 * overrides must be resolved without reaching the AI at all. A regression that ignored
 * the override would try to call a provider and fail here.
 */

test('an override replaces the generated heading and paragraph', async () => {
  const { attachNarratives } = await import('../src/services/reportService.js');
  const report = {
    items: [
      {
        id: 'agent-1-x-2026-09-24',
        title: 'Aramex order automation plugin for blh3jaemh.output — Built a plugin',
        reportTitle: 'Aramex order automation plugin for hotpoint.co.ke',
        reportNarrative: 'Stopped orders sticking on hold after packing slips.',
        subtasks: [],
      },
    ],
  };
  await attachNarratives(report, 1);
  const [item] = report.items;
  assert.equal(item.project, 'Aramex order automation plugin for hotpoint.co.ke');
  assert.equal(item.narrative, 'Stopped orders sticking on hold after packing slips.');
  assert.equal(item.edited, true, 'the panel marks a corrected line so it is not silently different');
});

test('an override still wins under refresh', async () => {
  // End Day Reset passes refresh:true to rewrite stale narratives. If that beat an edit,
  // a correction would last only until the next wrap-up.
  const { attachNarratives } = await import('../src/services/reportService.js');
  const report = {
    items: [{ id: 'x', title: 'Repo — did things', reportTitle: 'Hotpoint', reportNarrative: 'Mine.', subtasks: [] }],
  };
  await attachNarratives(report, 1, { refresh: true });
  assert.equal(report.items[0].project, 'Hotpoint');
  assert.equal(report.items[0].narrative, 'Mine.');
});

test('a blank override is not an override', async () => {
  // Clearing writes NULL, but whitespace must not count as a correction either -- it
  // would blank the report line rather than restore the generated one.
  const { attachNarratives } = await import('../src/services/reportService.js');
  const report = {
    items: [{ id: 'x', title: 'Hotpoint — shipped the plugin', reportTitle: '   ', reportNarrative: '  ', subtasks: [] }],
  };
  await attachNarratives(report, 1);
  assert.equal(report.items[0].project, 'Hotpoint', 'falls back to the derived heading');
  assert.equal(report.items[0].narrative, 'shipped the plugin', 'falls back to the derived outcome');
  assert.equal(report.items[0].edited, false);
});
