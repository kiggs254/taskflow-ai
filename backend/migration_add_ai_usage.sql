-- Migration: AI usage / cost telemetry
-- Run: psql -U <user> -d <db> -f migration_add_ai_usage.sql
--
-- `response.usage` was returned by every AI call and never read, so there was no
-- visibility into token spend, latency, or error rates per provider. This table is
-- what makes the DeepSeek migration decidable on evidence rather than vibes.
--
-- Written fire-and-forget from callAI: telemetry must never fail a user request.

CREATE TABLE IF NOT EXISTS ai_usage (
    id BIGSERIAL PRIMARY KEY,
    -- SET NULL, not CASCADE: cost history should survive user deletion.
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    task_kind VARCHAR(64) NOT NULL,        -- 'parse_task' | 'report_rollup' | 'analytics_narrative' | ...
    provider VARCHAR(32) NOT NULL,         -- 'openai' | 'deepseek'
    model VARCHAR(64) NOT NULL,
    tier VARCHAR(16),                      -- 'fast' | 'smart'
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cached_prompt_tokens INTEGER,          -- DeepSeek context-cache hits
    cost_usd NUMERIC(10,6),
    latency_ms INTEGER,
    ok BOOLEAN NOT NULL DEFAULT true,
    error_code VARCHAR(64),                -- http status or error class when ok = false
    fell_back BOOLEAN DEFAULT false,       -- true when the primary provider was skipped
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_kind_created ON ai_usage(task_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at DESC);
