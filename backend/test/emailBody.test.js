import test from 'node:test';
import assert from 'node:assert/strict';

process.env.API_SECRET = 'test';
process.env.DATABASE_URL = 'postgres://invalid:5432/invalid';

const { extractEmailBody } = await import('../src/services/gmailService.js');
const b64 = (t) => Buffer.from(t).toString('base64');

test('reads a top-level body', () => {
  assert.equal(extractEmailBody({ body: { data: b64('top') } }), 'top');
});

test('concatenates text/plain parts', () => {
  assert.equal(
    extractEmailBody({ parts: [
      { mimeType: 'text/plain', body: { data: b64('a') } },
      { mimeType: 'text/html', body: { data: b64('<b>ignored</b>') } },
      { mimeType: 'text/plain', body: { data: b64('b') } },
    ]}),
    'ab'
  );
});

test('walks NESTED multipart', () => {
  // The previous scanner only looked one level deep, so a multipart/alternative inside
  // multipart/mixed — very common for mail with an attachment — yielded an empty body
  // and the AI was asked to triage nothing.
  assert.equal(
    extractEmailBody({ parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64('nested') } },
      ]},
    ]}),
    'nested'
  );
});

test('a missing or empty payload yields empty string, not a throw', () => {
  assert.equal(extractEmailBody(null), '');
  assert.equal(extractEmailBody(undefined), '');
  assert.equal(extractEmailBody({}), '');
});
