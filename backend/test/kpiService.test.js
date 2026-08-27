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
