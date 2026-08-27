import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommit, monthRange } from '../src/services/kpiService.js';

/**
 * The KPI figures rest entirely on parsing conventional-commit subjects, so these are
 * checked against real commit messages taken from the actual daily reports.
 */

test('classifies the real commit messages from the daily reports', () => {
  const cases = [
    ['fix(tingg): capture the real payment reference, not the 8-digit checkout id', 'fix', 'tingg'],
    ['feat(header): rebuild the header to the client mockup (fonts, colours)', 'feat', 'header'],
    ['revert(header): drop Bebas Neue + Montserrat, go back to the prod fonts', 'revert', 'header'],
    ['chore(security): bump Next.js 16.2.10 -> 16.2.11 (storefront + admin)', 'chore', 'security'],
    ['fix(perf): disable Next\'s in-memory data cache (cacheMaxMemorySize: 0)', 'fix', 'perf'],
    ['feat(partner-api): echo externalOrderId beside our order reference', 'feat', 'partner-api'],
    ['copy(pdp): rename the Mosmos plan to "Save & Buy"', 'copy', 'pdp'],
    ['seed: Afroval demo catalogue (19 brands, 7 categories, 50 products)', 'seed', null],
    ['docs: Afroval backend README (handover orientation)', 'docs', null],
  ];
  for (const [msg, type, scope] of cases) {
    const got = classifyCommit(msg);
    assert.ok(got, `should parse: ${msg}`);
    assert.equal(got.type, type, msg);
    assert.equal(got.scope, scope, msg);
  }
});

test('a non-conventional subject is not force-fitted into a category', () => {
  // Counting these as features would inflate the headline number.
  assert.equal(classifyCommit('Add consolidated migrate_all.sql'), null);
  assert.equal(classifyCommit('Fix GitHub repo list never populating'), null);
  assert.equal(classifyCommit(''), null);
});

test('only the subject line is parsed, not the body', () => {
  const c = classifyCommit('feat(orders): WhatsApp intake\n\nfix: something in the body');
  assert.equal(c.type, 'feat');
  assert.equal(c.subject, 'WhatsApp intake');
});

test('a breaking-change marker still classifies', () => {
  const c = classifyCommit('feat(api)!: drop the v1 endpoint');
  assert.equal(c.type, 'feat');
  assert.equal(c.breaking, true);
});

test('monthRange covers the whole month and nothing outside it', () => {
  const r = monthRange('2026-07');
  assert.equal(r.fromDay, '2026-07-01');
  assert.equal(r.toDay, '2026-07-31');
  assert.ok(r.sinceIso.startsWith('2026-07-01T00:00:00'));
  // End is the last instant of the 31st, so a commit at 23:59 is still in July.
  assert.ok(r.untilIso.startsWith('2026-07-31T23:59:59'));
});

test('monthRange handles the December rollover', () => {
  const r = monthRange('2026-12');
  assert.equal(r.toDay, '2026-12-31');
});

test('monthRange rejects a malformed month rather than guessing', () => {
  assert.throws(() => monthRange('July'), /YYYY-MM/);
  assert.throws(() => monthRange('2026-7'), /YYYY-MM/);
});

import { pct, responseHours } from '../src/services/kpiService.js';

test('pct reports null rather than 0 when there is nothing to divide by', () => {
  // "not measured" and "zero" are different claims; a KPI sheet must not conflate them.
  assert.equal(pct(0, 0), null);
  assert.equal(pct(3, 4), 75);
  assert.equal(pct(1, 3), 33.3);
});

test('responseHours takes the median gap from a report to the next fix', () => {
  const H = 3600000;
  const t0 = Date.UTC(2026, 6, 10, 9);
  // Reports at 09:00, 11:00, 13:00; fixes 1h, 5h, 3h later respectively.
  const arrivals = [t0, t0 + 2 * H, t0 + 4 * H];
  const fixes = [t0 + 1 * H, t0 + 7 * H, t0 + 7 * H];
  // gaps: 1h, 5h, 3h -> median 3h
  assert.equal(responseHours(arrivals, fixes), 3);
});

test('responseHours ignores a report with no fix after it, rather than scoring it zero', () => {
  const H = 3600000;
  const t0 = Date.UTC(2026, 6, 10, 9);
  // Second report never got a fix -- it must not be counted as an instant response.
  assert.equal(responseHours([t0, t0 + 100 * H], [t0 + 2 * H]), 2);
});

test('responseHours is null when there is nothing to measure', () => {
  assert.equal(responseHours([], [1]), null);
  assert.equal(responseHours([1], []), null);
});

import { scoreReport } from '../src/services/kpiService.js';

const cat = (name, weight, metrics) => ({ name, weight, metrics });
const M = (value, target) => ({ metric: 'm', value, target });

test('a metric with no data is not scored as a failure', () => {
  // Instrumentation gaps must not read as poor performance.
  const cats = [cat('A', 100, [
    M(90, { label: '≥ 85', op: 'gte', value: 85 }),
    M(null, { label: '< 1', op: 'lte', value: 1 }),
  ])];
  const { overall } = scoreReport(cats);
  assert.equal(cats[0].metricsScored, 1, 'only the measured metric is scored');
  assert.equal(cats[0].metrics[1].status, 'no-data');
  assert.equal(overall, 100, 'the missing one neither helps nor hurts');
});

test('"Tracked" metrics are reported but never scored', () => {
  const cats = [cat('A', 100, [
    M(167, { label: 'Tracked', op: null }),
    M(50, { label: '≥ 85', op: 'gte', value: 85 }),
  ])];
  scoreReport(cats);
  assert.equal(cats[0].metrics[0].status, 'no-target');
  assert.equal(cats[0].metricsScored, 1);
  assert.equal(cats[0].score, 0, 'the one scoreable metric missed');
});

test('gte / lte / eq are compared the right way round', () => {
  const cats = [cat('A', 100, [
    M(99.6, { label: '≥ 99.5', op: 'gte', value: 99.5 }),  // met
    M(0.4, { label: '< 1', op: 'lte', value: 1 }),          // met
    M(10, { label: '< 3', op: 'lte', value: 3 }),           // missed
    M(0, { label: '0', op: 'eq', value: 0 }),               // met
  ])];
  scoreReport(cats);
  assert.deepEqual(cats[0].metrics.map((m) => m.status), ['met', 'met', 'missed', 'met']);
  assert.equal(cats[0].score, 75);
});

test('the overall is renormalised over the weight actually scored', () => {
  // System unmeasurable: the total must reflect what WAS measured, not be dragged to 0.
  const cats = [
    cat('Feature', 30, [M(100, { label: '≥ 85', op: 'gte', value: 85 })]),
    cat('System', 30, [M(null, { label: '≥ 99.5', op: 'gte', value: 99.5 })]),
  ];
  const { overall, coverage } = scoreReport(cats);
  assert.equal(cats[1].score, null, 'a category with nothing measurable has no score');
  assert.equal(overall, 100);
  assert.equal(coverage, 30, 'and coverage says the score rests on 30% of the weighting');
});

test('coverage is 0 when nothing at all could be scored', () => {
  const { overall, coverage } = scoreReport([cat('A', 100, [M(null, { label: '< 1', op: 'lte', value: 1 })])]);
  assert.equal(overall, null, 'null, not 0 — an unscored report has no score');
  assert.equal(coverage, 0);
});
