import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * Drives callAI against mock OpenAI-compatible servers so retry/fallback behaviour
 * is exercised with real HTTP status codes and no network access.
 *
 * These caught a real bug: the OpenAI SDK retries twice by default, which multiplied
 * against our own retry loop into 9 requests against an already-rate-limited provider.
 */

process.env.API_SECRET = 'test';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.DEEPSEEK_API_KEY = 'sk-test';
// Point telemetry at a DB that does not exist: recordUsage must swallow the failure
// rather than break an AI call. If these tests pass, that contract holds.
process.env.DATABASE_URL = 'postgres://invalid:5432/invalid';

const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

const okBody = (who) => ({
  choices: [{ message: { content: JSON.stringify({ from: who }) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

const hits = { openai: [], deepseek: [] };
let openaiMode = 'ok';
let deepseekMode = 'ok';

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const srvOpenai = await listen((req, res) => {
  hits.openai.push(Date.now());
  if (openaiMode === 'ok') return send(res, 200, okBody('openai'));
  return send(res, Number(openaiMode), { error: { message: openaiMode } });
});
const srvDeepseek = await listen((req, res) => {
  hits.deepseek.push(Date.now());
  if (deepseekMode === 'ok') return send(res, 200, okBody('deepseek'));
  return send(res, Number(deepseekMode), { error: { message: deepseekMode } });
});

const envMod = await import('../src/config/env.js');
envMod.config.ai.openai.apiKey = 'sk-test';
envMod.config.ai.deepseek.apiKey = 'sk-test';
envMod.config.ai.deepseek.baseURL = `http://127.0.0.1:${srvDeepseek.address().port}/v1`;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srvOpenai.address().port}/v1`;

const { callAI } = await import('../src/services/ai/callAI.js');
const call = (o = {}) => callAI({ taskKind: 'test', messages: [{ role: 'user', content: 'hi' }], ...o });
const reset = () => { hits.openai = []; hits.deepseek = []; };

test.after(() => { srvOpenai.close(); srvDeepseek.close(); });

test('uses the primary provider and does not retry a success', async () => {
  reset(); openaiMode = 'ok';
  const r = await call();
  assert.equal(r.provider, 'openai');
  assert.equal(hits.openai.length, 1);
});

test('429 retries the same provider with backoff, then falls back', async () => {
  reset(); openaiMode = '429'; deepseekMode = 'ok';
  const r = await call();
  assert.equal(r.provider, 'deepseek');
  // Exactly 3 -- not 9. The SDK's own maxRetries is disabled so retry policy lives
  // in one place.
  assert.equal(hits.openai.length, 3);
  assert.ok(hits.openai[2] - hits.openai[0] >= 250, 'expected exponential backoff between attempts');
});

test('400 fails fast: it is our bug, and the other provider would reject it too', async () => {
  reset(); openaiMode = '400'; deepseekMode = 'ok';
  await assert.rejects(() => call());
  assert.equal(hits.openai.length, 1, 'must not retry a malformed request');
  assert.equal(hits.deepseek.length, 0, 'must not waste a fallback call on a 400');
});

test('5xx retries then falls back', async () => {
  reset(); openaiMode = '500'; deepseekMode = 'ok';
  assert.equal((await call()).provider, 'deepseek');
});

test('throws when every provider is down', async () => {
  reset(); openaiMode = '500'; deepseekMode = '500';
  await assert.rejects(() => call());
});

test('401 disables the provider for the process instead of retrying bad credentials', async () => {
  reset(); openaiMode = '401'; deepseekMode = 'ok';
  assert.equal((await call()).provider, 'deepseek');
  assert.equal(hits.openai.length, 1);

  // Subsequent calls skip it entirely.
  reset();
  const r = await call();
  assert.equal(hits.openai.length, 0);
  assert.equal(r.provider, 'deepseek');
});
