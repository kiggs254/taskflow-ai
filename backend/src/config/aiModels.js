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

// Order is the fallback order after the primary. Moonshot leads because it's the
// current primary (see primaryProvider); MiMo is last as the least-exercised path.
export const PROVIDERS = ['moonshot', 'deepseek', 'openai', 'mimo'];

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
  // Moonshot (Kimi), OpenAI-compatible on https://api.moonshot.ai/v1. Only two models
  // wired up: the cheap one for interactive `fast`, the pricier thinking-capable one
  // for offline `smart`. Both take `thinking:{type:...}` (default ENABLED), so callAI
  // sends `disabled` unless a caller opts in -- an always-reasoning model truncates
  // JSON before it emits any, exactly as deepseek-v4-pro did.
  moonshot: {
    fast: process.env.MOONSHOT_MODEL_FAST || 'kimi-k2.5',
    smart: process.env.MOONSHOT_MODEL_SMART || 'kimi-k2.6',
  },
  // Xiaomi MiMo, OpenAI-compatible on https://api.xiaomimimo.com/v1.
  mimo: {
    fast: process.env.MIMO_MODEL_FAST || 'mimo-v2-flash',
    smart: process.env.MIMO_MODEL_SMART || 'mimo-v2.5-pro',
  },
};

/**
 * Per-provider capabilities. Conservative by default: DeepSeek documents "JSON
 * Output" and "Tool Calls", which is not the same guarantee as OpenAI's
 * `strict: true` schema enforcement, so it stays on json_object until verified.
 */
export const CAPS = {
  openai: { strictSchema: true, toolCalls: true, thinkingToggle: false },
  // DeepSeek V4 has a thinking toggle, and in thinking mode the chain-of-thought is
  // returned as `reasoning_content` -- which is billed against max_tokens. Left on,
  // deepseek-v4-pro burns the whole budget reasoning about a one-line summary and
  // gets truncated before it emits any JSON. Every call here is extraction or
  // summarisation, so thinking is off unless a caller asks for it.
  deepseek: { strictSchema: false, toolCalls: true, thinkingToggle: true },
  // Kimi k2.5/k2.6 take the identical `thinking:{type:'enabled'|'disabled'}` field, and
  // default to ENABLED -- so the toggle is load-bearing here, not optional: without the
  // explicit `disabled`, every extraction call reasons first and truncates.
  moonshot: { strictSchema: false, toolCalls: true, thinkingToggle: true },
  // MiMo's JSON/tool guarantees aren't documented, so treat it like DeepSeek's
  // json_object path (schema goes in the prompt) and don't send a thinking field.
  mimo: { strictSchema: false, toolCalls: true, thinkingToggle: false },
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
  // Moonshot Kimi, USD per 1M tokens (cache-miss input).
  'kimi-k2.5': { in: 0.6, out: 3.0 },
  'kimi-k2.6': { in: 0.95, out: 4.0 },
  // MiMo pricing isn't published here; a missing entry logs null cost rather than
  // throwing, so leaving it out is safe until confirmed.
};

/**
 * Provider order. Falling back to a second provider is only useful if it is
 * actually configured, so the chain is filtered by key presence at call time.
 */
// Moonshot is the current default primary ("make it main for now"). AI_PRIMARY_PROVIDER
// still overrides. If MOONSHOT_API_KEY isn't set, callAI filters moonshot out of the
// chain by client presence and the request falls through to the next configured
// provider, so an unset key degrades rather than breaks.
export const primaryProvider = () => {
  const p = process.env.AI_PRIMARY_PROVIDER;
  return PROVIDERS.includes(p) ? p : 'moonshot';
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
