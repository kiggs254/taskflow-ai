/**
 * Central AI model registry.
 *
 * Model ids were previously inlined as `provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini'`
 * at 11 separate call sites in aiService.js, so any model change meant 11 edits and
 * there was no way to use a stronger model for a harder task.
 *
 * Every id is env-overridable on purpose: a wrong model id is a 400 on every AI
 * call in production, and this turns that from "redeploy" into "edit a Coolify var".
 *
 * Tiers:
 *   fast  — interactive paths (parse-task on the add-task keystroke). Latency is the feature.
 *   smart — cron/offline paths (daily report rollup, analytics narrative). Nobody is waiting.
 */

export const PROVIDERS = ['openai', 'deepseek'];

export const MODELS = {
  openai: {
    fast: process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini',
    smart: process.env.OPENAI_MODEL_SMART || 'gpt-4o',
  },
  deepseek: {
    // DeepSeek V4 supersedes the legacy `deepseek-chat` alias. Both are
    // OpenAI-compatible on the same base_url and support JSON output + tool calls.
    fast: process.env.DEEPSEEK_MODEL_FAST || 'deepseek-v4-flash',
    smart: process.env.DEEPSEEK_MODEL_SMART || 'deepseek-v4-pro',
  },
};

/**
 * Per-provider capabilities. Conservative by default: DeepSeek documents "JSON
 * Output" and "Tool Calls", which is not the same guarantee as OpenAI's
 * `strict: true` schema enforcement, so it stays on json_object until verified.
 */
export const CAPS = {
  openai: { strictSchema: true, toolCalls: true },
  deepseek: { strictSchema: false, toolCalls: true },
};

/**
 * USD per 1M tokens. Used only for cost telemetry; a missing entry logs null cost
 * rather than throwing.
 */
export const PRICING = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'deepseek-v4-flash': { in: 0.028, out: 0.42 },
  'deepseek-v4-pro': { in: 0.28, out: 1.68 },
  'deepseek-chat': { in: 0.14, out: 0.28 },
};

/**
 * Provider order. Falling back to a second provider is only useful if it is
 * actually configured, so the chain is filtered by key presence at call time.
 */
export const primaryProvider = () => {
  const p = process.env.AI_PRIMARY_PROVIDER;
  return PROVIDERS.includes(p) ? p : 'openai';
};

export const providerChain = (preferred) => {
  const first = PROVIDERS.includes(preferred) ? preferred : primaryProvider();
  return [first, ...PROVIDERS.filter((p) => p !== first)];
};

/**
 * Resolve a model id. Falls back to the primary provider's tier rather than
 * throwing — an unknown provider string should degrade, not break the request.
 */
export const modelFor = (provider, tier = 'fast') => {
  const t = tier === 'smart' ? 'smart' : 'fast';
  return MODELS[provider]?.[t] ?? MODELS[primaryProvider()][t];
};

export const costUsd = (model, promptTokens = 0, completionTokens = 0) => {
  const p = PRICING[model];
  if (!p) return null;
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
};
