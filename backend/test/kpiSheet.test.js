import test from 'node:test';
import assert from 'node:assert/strict';
import { explainGoogleError, toTsv } from '../src/services/kpiSheet.js';

/**
 * The first version of this asserted every failure was a missing scope, which sent the
 * reader off to reconnect a perfectly good account while hiding what Google actually
 * said. These pin the distinct cases apart.
 */

test('an unenabled Sheets API says so, and does not tell you to reconnect', () => {
  // The real shape Google returns for a project that has never enabled the API.
  const e = {
    code: 403,
    response: { data: { error: { message: 'Google Sheets API has not been used in project 123456789 before or it is disabled.' } } },
  };
  const out = explainGoogleError(e).message;
  assert.match(out, /not enabled for the Cloud project/i);
  assert.match(out, /console\.cloud\.google\.com\/apis\/library\/sheets\.googleapis\.com\?project=123456789/);
  assert.doesNotMatch(out, /reconnect Gmail/i);
  assert.match(out, /Google said:/, 'the original message is preserved');
});

test('a genuine scope problem still points at reconnecting', () => {
  const e = { code: 403, errors: [{ message: 'Request had insufficient authentication scopes.' }] };
  const out = explainGoogleError(e).message;
  assert.match(out, /missing the Sheets scope/i);
  assert.match(out, /reconnect Gmail/i);
});

test('a 404 is reported as a missing sheet, not a permissions problem', () => {
  const e = { code: 404, response: { data: { error: { message: 'Requested entity was not found.' } } } };
  assert.match(explainGoogleError(e).message, /No spreadsheet with that ID/i);
});

test('a plain 403 talks about sheet ownership, not scopes', () => {
  const e = { code: 403, response: { data: { error: { message: 'The caller does not have permission' } } } };
  const out = explainGoogleError(e).message;
  assert.match(out, /owned by, or shared with/i);
  assert.doesNotMatch(out, /not enabled/i);
});

test('an unrecognised error still surfaces what Google said', () => {
  const e = { code: 500, message: 'Backend Error' };
  assert.match(explainGoogleError(e).message, /Backend Error/);
});

test('the TSV grid keeps unmeasured values blank rather than zero-filling', () => {
  const tsv = toTsv({
    month: '2026-07',
    period: { from: '2026-07-01', to: '2026-07-31' },
    categories: [{ name: 'Bugs', weight: 20, metrics: [
      { metric: 'Bugs Fixed', target: 'Tracked', value: 12, source: 'auto', note: 'fix: commits' },
      { metric: 'Bug Backlog', target: '< 5', value: null, source: 'auto', note: 'no data' },
    ]}],
    evidence: { repos: 1, commits: 5, unconventionalCommits: 0, fleetConnected: true },
  });
  const backlog = tsv.split('\n').find((l) => l.startsWith('Bug Backlog'));
  assert.equal(backlog.split('\t')[2], '', 'null renders blank, never 0');
});
