import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, providerChain, primaryProvider, costUsd, CAPS, PROVIDERS } from '../src/config/aiModels.js';

test('deepseek resolves to the current V4 models, not the legacy alias', () => {
  assert.equal(modelFor('deepseek', 'smart'), 'deepseek-v4-pro');
  assert.equal(modelFor('deepseek', 'fast'), 'deepseek-v4-flash');
  assert.notEqual(modelFor('deepseek', 'fast'), 'deepseek-chat');
});

test('moonshot wires up a cheap fast model and a thinking-capable smart model', () => {
  assert.equal(modelFor('moonshot', 'fast'), 'kimi-k2.5');
  assert.equal(modelFor('moonshot', 'smart'), 'kimi-k2.6');
  // Kimi thinking models default to reasoning ON and bill it against max_tokens, so the
  // toggle must exist for callAI to turn it off for JSON extraction.
  assert.equal(CAPS.moonshot.thinkingToggle, true);
  assert.equal(CAPS.moonshot.strictSchema, false);
});

test('mimo is configured, OpenAI-compatible, with no thinking field sent', () => {
  assert.equal(modelFor('mimo', 'smart'), 'mimo-v2.5-pro');
  assert.equal(CAPS.mimo.thinkingToggle, false);
});

test('moonshot is the default primary provider', () => {
  const saved = process.env.AI_PRIMARY_PROVIDER;
  delete process.env.AI_PRIMARY_PROVIDER;
  assert.equal(primaryProvider(), 'moonshot');
  assert.equal(providerChain('nonsense')[0], 'moonshot');
  if (saved !== undefined) process.env.AI_PRIMARY_PROVIDER = saved;
});

test('an unknown provider degrades to the primary rather than throwing', () => {
  assert.equal(typeof modelFor('mistral', 'fast'), 'string');
  assert.equal(typeof modelFor(undefined, 'smart'), 'string');
});

test('providerChain puts the preferred provider first and lists every provider once', () => {
  assert.equal(providerChain('deepseek')[0], 'deepseek');
  assert.equal(providerChain('openai')[0], 'openai');
  assert.equal(providerChain('nonsense').length, PROVIDERS.length);
  assert.equal(new Set(providerChain('deepseek')).size, PROVIDERS.length);
});

test('costUsd prices per 1M tokens and tolerates unknown models', () => {
  // 1M in @ 0.15 + 1M out @ 0.60
  assert.ok(Math.abs(costUsd('gpt-4o-mini', 1e6, 1e6) - 0.75) < 1e-9);
  assert.equal(costUsd('unknown-model', 10, 10), null);
});

test('deepseek is not assumed to enforce strict schemas', () => {
  // DeepSeek documents JSON output + tool calls, which is not the same guarantee as
  // OpenAI strict mode. Conservative until verified against the live API.
  assert.equal(CAPS.openai.strictSchema, true);
  assert.equal(CAPS.deepseek.strictSchema, false);
});
