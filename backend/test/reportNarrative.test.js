import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * attachNarratives against a mock OpenAI-compatible server: proves the report's one AI
 * path sets project + narrative, content-caches so repeated previews don't re-bill, and
 * falls back to the title outcome when the model fails rather than blanking the report.
 */

process.env.API_SECRET = 'test';
// Route narration at the mock openai server below; the product default primary is now
// moonshot, which this test doesn't stand up.
process.env.AI_PRIMARY_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.DEEPSEEK_API_KEY = 'sk-test';
process.env.DATABASE_URL = 'postgres://invalid:5432/invalid';

let hits = 0;
let mode = 'ok';
let lastBody = null;
const server = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    hits++;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { lastBody = JSON.parse(raw); } catch { /* ignore */ }
      if (mode === 'fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'boom' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ narrative: 'A short story of the work.' }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      }));
    });
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const port = server.address().port;

const envMod = await import('../src/config/env.js');
envMod.config.ai.openai.apiKey = 'sk-test';
envMod.config.ai.deepseek.apiKey = 'sk-test';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

const { attachNarratives } = await import('../src/services/reportService.js');

test.after(() => server.close());

test('sets project and narrative on every item', async () => {
  mode = 'ok'; hits = 0;
  const report = { items: [
    { title: 'hotpoint-front — WhatsApp orders', subtasks: [{ title: 'feat(orders): x', completed: true }] },
  ]};
  await attachNarratives(report, 1);
  assert.equal(report.items[0].project, 'hotpoint-front');
  assert.equal(report.items[0].narrative, 'A short story of the work.');
});

test('the narrative is asked for in impersonal past tense, no "we" or "I"', async () => {
  // One person's own log: "We built…" is wrong, and a repeated "I …, I …" reads badly.
  // Verb-first with no subject pronoun avoids both.
  mode = 'ok'; hits = 0; lastBody = null;
  await attachNarratives({ items: [
    { title: 'solo-proj — a thing', subtasks: [{ title: 'commit-impersonal-xyz', completed: true }] },
  ]}, 1);
  const system = lastBody.messages.find((m) => m.role === 'system').content;
  assert.match(system, /impersonal past tense/i);
  assert.match(system, /no subject pronoun/i);
  assert.match(system, /never use "we" or "I"/i);
});

test('identical commit sets are cached, so a second pass makes no new call', async () => {
  mode = 'ok'; hits = 0;
  const mk = () => ({ items: [
    { title: 'repoZ — did things', subtasks: [{ title: 'commit-unique-abc', completed: true }] },
  ]});
  await attachNarratives(mk(), 1);
  const afterFirst = hits;
  assert.ok(afterFirst >= 1, 'first pass calls the model');
  await attachNarratives(mk(), 1);
  assert.equal(hits, afterFirst, 'second pass is served from cache');
});

test('falls back to the title outcome when the model fails, never blank', async () => {
  mode = 'fail'; hits = 0;
  const report = { items: [
    { title: 'billing-svc — Reconciled the ledger', subtasks: [{ title: 'commit-xyz-fail', completed: true }] },
  ]};
  await attachNarratives(report, 1);
  assert.equal(report.items[0].narrative, 'Reconciled the ledger', 'fallback is the outcome after the em dash');
});

test('an item with no subtasks is narrated as its title outcome without calling the model', async () => {
  mode = 'ok'; hits = 0;
  const report = { items: [{ title: 'notes — Wrote the design doc', subtasks: [] }] };
  await attachNarratives(report, 1);
  assert.equal(hits, 0, 'nothing to summarise -> no call');
  assert.equal(report.items[0].narrative, 'Wrote the design doc');
});
