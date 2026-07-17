import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, providerChain, costUsd, CAPS } from '../src/config/aiModels.js';

test('deepseek resolves to the current V4 models, not the legacy alias', () => {
  assert.equal(modelFor('deepseek', 'smart'), 'deepseek-v4-pro');
  assert.equal(modelFor('deepseek', 'fast'), 'deepseek-v4-flash');
  assert.notEqual(modelFor('deepseek', 'fast'), 'deepseek-chat');
});

test('an unknown provider degrades to the primary rather than throwing', () => {
  assert.equal(typeof modelFor('mistral', 'fast'), 'string');
  assert.equal(typeof modelFor(undefined, 'smart'), 'string');
});

test('providerChain puts the preferred provider first', () => {
  assert.equal(providerChain('deepseek')[0], 'deepseek');
  assert.equal(providerChain('openai')[0], 'openai');
  assert.equal(providerChain('nonsense').length, 2);
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
