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
  choices: [{ message: { content: JSON.stringify({ from: who }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

// A truncated response: HTTP 200, but the JSON is cut off mid-emit.
const truncatedBody = () => ({
  choices: [{ message: { content: '{"summary":"half a sen' }, finish_reason: 'length' }],
  usage: { prompt_tokens: 10, completion_tokens: 400 },
});

const hits = { openai: [], deepseek: [] };
const bodies = { openai: [], deepseek: [] };
let openaiMode = 'ok';
let deepseekMode = 'ok';

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Capture the request body: what we actually send is the thing worth asserting on.
const capture = (who, req, then) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    try { bodies[who].push(JSON.parse(raw)); } catch { /* ignore */ }
    then();
  });
};

const srvOpenai = await listen((req, res) => {
  hits.openai.push(Date.now());
  capture('openai', req, () => {
    if (openaiMode === 'ok') return send(res, 200, okBody('openai'));
    if (openaiMode === 'truncated') return send(res, 200, truncatedBody());
    return send(res, Number(openaiMode), { error: { message: openaiMode } });
  });
});
const srvDeepseek = await listen((req, res) => {
  hits.deepseek.push(Date.now());
  capture('deepseek', req, () => {
    if (deepseekMode === 'ok') return send(res, 200, okBody('deepseek'));
    if (deepseekMode === 'truncated') return send(res, 200, truncatedBody());
    return send(res, Number(deepseekMode), { error: { message: deepseekMode } });
  });
});

const envMod = await import('../src/config/env.js');
envMod.config.ai.openai.apiKey = 'sk-test';
envMod.config.ai.deepseek.apiKey = 'sk-test';
envMod.config.ai.deepseek.baseURL = `http://127.0.0.1:${srvDeepseek.address().port}/v1`;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srvOpenai.address().port}/v1`;

const { callAI } = await import('../src/services/ai/callAI.js');
const call = (o = {}) => callAI({ taskKind: 'test', messages: [{ role: 'user', content: 'hi' }], ...o });
const reset = () => { hits.openai = []; hits.deepseek = []; bodies.openai = []; bodies.deepseek = []; };

const SCHEMA = {
  name: 'thing',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: { summary: { type: 'string' } },
  },
};

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

test('400 does not retry the same provider, but DOES try the next one', async () => {
  // The most common 400 in practice is an unknown model id, and model ids are
  // provider-specific — `deepseek-v4-pro` being rejected says nothing about
  // `gpt-4o`. An earlier version treated 400 as terminal, so one wrong id in config
  // silently disabled AI everywhere with no fallback.
  reset(); openaiMode = '400'; deepseekMode = 'ok';
  const r = await call();
  assert.equal(r.provider, 'deepseek', 'should fall through to the other provider');
  assert.equal(hits.openai.length, 1, 'must not retry an identical bad request');
});

test('400 on every provider still throws rather than hanging', async () => {
  reset(); openaiMode = '400'; deepseekMode = '400';
  await assert.rejects(() => call());
  assert.equal(hits.openai.length, 1, 'one attempt each, no retries');
  assert.equal(hits.deepseek.length, 1);
});

test('5xx retries then falls back', async () => {
  reset(); openaiMode = '500'; deepseekMode = 'ok';
  assert.equal((await call()).provider, 'deepseek');
});

test('throws when every provider is down', async () => {
  reset(); openaiMode = '500'; deepseekMode = '500';
  await assert.rejects(() => call());
});

/**
 * Structured output. The bug these guard against was invisible in production: the
 * API call succeeded, telemetry said ok=true, and the only symptom was inexplicably
 * generic output, because the model was never told what fields to emit and the
 * caller read `undefined` off valid-but-differently-shaped JSON.
 */

test('OpenAI gets the schema enforced server-side via json_schema', async () => {
  reset(); openaiMode = 'ok';
  await call({ provider: 'openai', schema: SCHEMA });
  const body = bodies.openai[0];
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, SCHEMA.schema);
  // It's enforced, so don't waste prompt tokens restating it.
  assert.ok(!JSON.stringify(body.messages).includes('exact schema'));
});

test('DeepSeek is TOLD the schema, since json_object only guarantees valid JSON', async () => {
  reset(); deepseekMode = 'ok';
  await call({ provider: 'deepseek', schema: SCHEMA, messages: [
    { role: 'system', content: 'You summarise.' },
    { role: 'user', content: 'go' },
  ]});
  const body = bodies.deepseek[0];
  assert.equal(body.response_format.type, 'json_object');

  const system = body.messages.find((m) => m.role === 'system').content;
  // The field name has to reach the model, or the caller reads undefined and
  // silently falls back to a default.
  assert.ok(system.includes('summary'), 'schema field names must be in the prompt');
  assert.ok(system.includes('You summarise.'), 'original system prompt preserved');
  // DeepSeek's JSON mode requires the literal word "json" in the prompt.
  assert.ok(/json/i.test(system));
});

test('the schema is appended to the existing system message, not prepended as a new one', async () => {
  // DeepSeek's prompt cache keys on the message prefix; inserting a message would
  // shift it and lose the cache on every call.
  reset(); deepseekMode = 'ok';
  await call({ provider: 'deepseek', schema: SCHEMA, messages: [
    { role: 'system', content: 'STABLE PREFIX' },
    { role: 'user', content: 'go' },
  ]});
  const msgs = bodies.deepseek[0].messages;
  assert.equal(msgs.length, 2, 'no extra message inserted');
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.startsWith('STABLE PREFIX'), 'prefix must stay first');
});

test('a schemaless call is left completely alone', async () => {
  reset(); deepseekMode = 'ok';
  await call({ provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }] });
  const body = bodies.deepseek[0];
  assert.equal(body.response_format, undefined);
  assert.equal(body.messages.length, 1);
});

/**
 * Truncation and thinking mode.
 *
 * DeepSeek V4 reasons before answering and the chain-of-thought is billed against
 * max_tokens. Left enabled, deepseek-v4-pro spent the entire budget reasoning about a
 * one-line summary and never emitted JSON — the response came back HTTP 200 with
 * finish_reason 'length', telemetry logged ok=true, and the caller just saw JSON.parse
 * fail and fall back to a generic title. Nothing anywhere said "truncated".
 */

test('a truncated response is an error, not silently-broken JSON', async () => {
  reset(); openaiMode = 'truncated'; deepseekMode = 'truncated';
  await assert.rejects(() => call({ maxTokens: 400 }), /truncated at max_tokens=400/);
});

test('truncation does not retry the same provider, but does try the next', async () => {
  // Retrying with the same budget and model truncates identically; the other provider
  // may not reason first.
  reset(); openaiMode = 'truncated'; deepseekMode = 'ok';
  const r = await call({ maxTokens: 400 });
  assert.equal(r.provider, 'deepseek');
  assert.equal(hits.openai.length, 1, 'no pointless retry of the same budget');
});

test('thinking is DISABLED for DeepSeek by default', async () => {
  reset(); deepseekMode = 'ok';
  await call({ provider: 'deepseek' });
  assert.deepEqual(bodies.deepseek[0].thinking, { type: 'disabled' });
});

test('thinking can be opted into', async () => {
  reset(); deepseekMode = 'ok';
  await call({ provider: 'deepseek', thinking: true });
  assert.deepEqual(bodies.deepseek[0].thinking, { type: 'enabled' });
});

test('the thinking field is never sent to OpenAI — an unknown field is a 400', async () => {
  reset(); openaiMode = 'ok';
  await call({ provider: 'openai' });
  assert.equal('thinking' in bodies.openai[0], false);
});

/**
 * NOTE: everything below this point runs AFTER openai has been marked dead for
 * the process by the 401 test -- that's the behaviour under test, and
 * deadProviders is module-level by design. Tests needing a live openai must go
 * above it.
 */

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
