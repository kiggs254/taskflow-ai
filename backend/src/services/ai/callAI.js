import OpenAI from 'openai';
import { config } from '../../config/env.js';
import { query } from '../../config/database.js';
import { CAPS, costUsd, modelFor, providerChain } from '../../config/aiModels.js';

/**
 * Single entry point for every AI call.
 *
 * Replaces a pattern where each of 11 call sites inlined its own model ternary,
 * its own error handling, and no timeout at all. Centralising gives us, in one
 * place: model resolution, structured output, timeouts, sane retry/fallback, and
 * cost telemetry.
 */

// maxRetries: 0 is deliberate and load-bearing. The SDK retries twice by default,
// which silently multiplied against our own retry loop: 3 attempts x 3 SDK tries =
// 9 requests fired at a provider that had just returned 429, with our backoff
// applying only between the outer attempts. Retry policy lives in exactly one place.
const clientOpts = { maxRetries: 0 };

const clients = {
  openai: config.ai.openai.apiKey
    ? new OpenAI({ apiKey: config.ai.openai.apiKey, ...clientOpts })
    : null,
  deepseek: config.ai.deepseek.apiKey
    ? new OpenAI({
        apiKey: config.ai.deepseek.apiKey,
        baseURL: config.ai.deepseek.baseURL,
        ...clientOpts,
      })
    : null,
};

export const isProviderConfigured = (provider) => Boolean(clients[provider]);

// Providers that returned 401/403 are unusable for the life of the process.
// Retrying a bad key on every request just adds latency to a guaranteed failure.
const deadProviders = new Set();

const TIMEOUT_MS = { fast: 30_000, smart: 90_000 };
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Classify by status code, not by string-matching error.message.
 *
 * The old tryWithFallback matched substrings like 'apiKey' and 'not configured'
 * against the message text, then ran the *same* fallback for both branches -- so the
 * classification was elaborate and did nothing.
 *
 * On 400: don't retry the SAME provider (the request won't get better by repeating
 * it), but DO try the next one. An earlier version treated 400 as terminal on the
 * reasoning that "the other provider would reject it identically" -- which is true
 * for a malformed request and false for the most likely 400 of all, an unknown model
 * id. Model ids are provider-specific: `deepseek-v4-pro` being rejected says nothing
 * about `gpt-4o`. Treating that as terminal meant one wrong id in config silently
 * disabled AI everywhere, with no fallback, surfacing only as degraded output.
 */
const classify = (err) => {
  // Retrying the same provider would truncate identically -- same budget, same model.
  // The other provider may not reason first, so it's still worth a try.
  if (err?.truncated) return 'no_retry';
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) return 'auth';       // provider unusable
  if (status === 429) return 'retry';                        // rate limited
  if (status >= 500) return 'retry';                         // provider fault
  if (status === 400 || status === 422) return 'no_retry';   // bad request for THIS provider
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'retry';
  const code = err?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return 'retry';
  return 'fallback'; // unknown: worth trying the other provider once
};

/**
 * Fire-and-forget usage record. Telemetry must never fail a user request, so every
 * error here is swallowed deliberately.
 */
const recordUsage = (row) => {
  query(
    `INSERT INTO ai_usage (
       user_id, task_kind, provider, model, tier, prompt_tokens, completion_tokens,
       cached_prompt_tokens, cost_usd, latency_ms, ok, error_code, fell_back
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      row.userId ?? null,
      row.taskKind,
      row.provider,
      row.model,
      row.tier ?? null,
      row.promptTokens ?? null,
      row.completionTokens ?? null,
      row.cachedPromptTokens ?? null,
      row.costUsd ?? null,
      row.latencyMs ?? null,
      row.ok,
      row.errorCode ?? null,
      row.fellBack ?? false,
    ]
  ).catch(() => {});
};

const buildResponseFormat = (provider, schema) => {
  if (!schema) return undefined;
  // Only OpenAI enforces the schema server-side (`strict: true`). DeepSeek's
  // json_object mode guarantees *valid JSON*, not *this* JSON -- see
  // withSchemaInPrompt for how the shape gets conveyed instead.
  if (CAPS[provider]?.strictSchema) {
    return {
      type: 'json_schema',
      json_schema: { name: schema.name, schema: schema.schema, strict: true },
    };
  }
  return { type: 'json_object' };
};

/**
 * Put the schema in the prompt for providers that don't enforce it.
 *
 * This is not a nicety. Under `json_object` the model is only told "emit JSON" --
 * never which fields. It happily returns valid JSON with its own key names, the
 * caller reads `parsed.summary` (or `.title`, `.energy`...), gets undefined, and
 * silently falls back to a default. That failure is invisible: the API call
 * succeeds, telemetry records ok=true, and the only symptom is mysteriously generic
 * output -- e.g. commit tasks titled "repo — N commits" while every rollup call
 * reported success.
 *
 * DeepSeek's own JSON-mode docs require the word "json" in the prompt and recommend
 * showing the expected shape; this does both.
 */
const withSchemaInPrompt = (provider, messages, schema) => {
  if (!schema || CAPS[provider]?.strictSchema) return messages;

  const instruction =
    `\n\nRespond with a json object matching this exact schema. Use these exact ` +
    `field names, and include every required field:\n${JSON.stringify(schema.schema)}`;

  const systemIndex = messages.findIndex((m) => m.role === 'system');
  if (systemIndex === -1) {
    return [{ role: 'system', content: instruction.trim() }, ...messages];
  }

  // Appended to the system message rather than added as a new one: DeepSeek's prompt
  // cache keys on the message prefix, and inserting a message would shift it.
  return messages.map((m, i) =>
    i === systemIndex ? { ...m, content: m.content + instruction } : m
  );
};

/**
 * @param {object}   opts
 * @param {string}   opts.taskKind    telemetry label, e.g. 'parse_task'
 * @param {string}  [opts.provider]   preferred provider; falls back to the chain
 * @param {string}  [opts.tier]       'fast' | 'smart'
 * @param {Array}    opts.messages    chat messages
 * @param {object}  [opts.schema]     { name, schema } -> structured output
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTokens]
 * @param {boolean} [opts.thinking]   let the model reason first (costs max_tokens)
 * @param {number}  [opts.userId]     for telemetry attribution
 * @returns {Promise<{content: string, provider: string, model: string, usage: object}>}
 */
export const callAI = async ({
  taskKind,
  provider,
  tier = 'fast',
  messages,
  schema,
  temperature = 0,
  maxTokens,
  thinking = false,
  userId = null,
}) => {
  const chain = providerChain(provider).filter(
    (p) => clients[p] && !deadProviders.has(p)
  );

  if (!chain.length) {
    throw new Error(
      'No AI provider configured. Set OPENAI_API_KEY and/or DEEPSEEK_API_KEY.'
    );
  }

  let lastError;

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const model = modelFor(p, tier);
    const fellBack = i > 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const response = await clients[p].chat.completions.create(
          {
            model,
            // Per-provider: only providers that can't enforce the schema get told
            // about it in the prompt.
            messages: withSchemaInPrompt(p, messages, schema),
            temperature,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            ...(schema ? { response_format: buildResponseFormat(p, schema) } : {}),
            // Only where the provider understands it -- an unknown field is a 400.
            ...(CAPS[p]?.thinkingToggle
              ? { thinking: { type: thinking ? 'enabled' : 'disabled' } }
              : {}),
          },
          // No request ever had a timeout: a hung provider would hang a cron sweep
          // indefinitely, and node-cron would happily start another one behind it.
          { signal: AbortSignal.timeout(TIMEOUT_MS[tier] ?? TIMEOUT_MS.fast) }
        );

        // Truncation is silent by default and pathological to debug: the HTTP call
        // succeeds, telemetry says ok=true, and the caller just gets JSON that won't
        // parse. That cost three rounds of investigation for exactly one reason --
        // deepseek-v4-pro reasoning past max_tokens before emitting any JSON.
        // finish_reason tells us outright, so treat it as the error it is.
        const finishReason = response.choices[0]?.finish_reason;
        if (finishReason === 'length') {
          const err = new Error(
            `AI response truncated at max_tokens=${maxTokens} (${p}/${model}). ` +
              `The output is incomplete, so it cannot be parsed. Raise maxTokens, or ` +
              `disable thinking: reasoning tokens are billed against this budget.`
          );
          err.truncated = true;
          throw err;
        }

        const usage = response.usage ?? {};
        recordUsage({
          userId,
          taskKind,
          provider: p,
          model,
          tier,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          cachedPromptTokens:
            usage.prompt_cache_hit_tokens ??
            usage.prompt_tokens_details?.cached_tokens,
          costUsd: costUsd(model, usage.prompt_tokens, usage.completion_tokens),
          latencyMs: Date.now() - started,
          ok: true,
          fellBack,
        });

        return {
          content: response.choices[0]?.message?.content ?? '',
          provider: p,
          model,
          usage,
        };
      } catch (err) {
        lastError = err;
        const kind = classify(err);
        // 'truncated' is worth its own code: it's the difference between "the provider
        // rejected us" and "we asked for less room than the model needed".
        const status = err?.truncated
          ? 'truncated'
          : err?.status ?? err?.response?.status ?? err?.name;

        recordUsage({
          userId,
          taskKind,
          provider: p,
          model,
          tier,
          latencyMs: Date.now() - started,
          ok: false,
          errorCode: String(status ?? 'unknown'),
          fellBack,
        });

        if (kind === 'auth') {
          console.error(`AI provider ${p} rejected credentials; disabling for this process.`);
          deadProviders.add(p);
          break; // try the next provider
        }

        if (kind === 'no_retry') {
          // Repeating an identical bad request is pointless, but the next provider
          // may well accept it -- an unknown model id is per-provider. Fall through
          // without burning retries here.
          console.error(
            `AI: ${p}/${model} rejected the request (${status}). Trying the next provider. ` +
              `If this is an unknown-model error, set the *_MODEL_* env var for ${p}.`
          );
          break;
        }

        if (kind === 'retry' && attempt < MAX_ATTEMPTS) {
          // Exponential backoff with jitter, so concurrent cron work doesn't
          // synchronise its retries into a thundering herd.
          const backoff = 250 * 2 ** (attempt - 1);
          await sleep(backoff + Math.random() * 100);
          continue;
        }

        break; // exhausted retries, or an unknown error: try the next provider
      }
    }
  }

  throw lastError ?? new Error(`AI call failed: ${taskKind}`);
};
