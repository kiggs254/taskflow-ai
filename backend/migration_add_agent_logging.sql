-- Migration: log work done in an external agent (Claude Code) as completed tasks
-- Run: psql -U <user> -d <db> -f migration_add_agent_logging.sql
--
-- GitHub commits already become tasks. A lot of real work isn't in a tracked repo at
-- all (WordPress plugins, ops), so it leaves no trace. These tables let a CLI hook
-- report finished sessions, without double-counting what GitHub covers and without
-- ever recording personal work.

-- ---------------------------------------------------------------------------
-- 1. Long-lived API tokens for machines.
--
-- The normal login token (utils/token.js) is a stateless HMAC with a 7-day expiry
-- and no scope claim. A hook using one would break silently every week, and minting
-- a long-lived one would grant unscoped full-account access with no way to revoke
-- it -- there's nothing to revoke *against* when the token is stateless.
--
-- So: a real row per token, sha256-hashed (a DB leak must not yield usable tokens),
-- revocable, and accepted ONLY on /api/agent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,              -- human label, e.g. "MacBook"
    token_hash VARCHAR(64) NOT NULL UNIQUE,  -- sha256 hex of the raw token
    prefix VARCHAR(16) NOT NULL,             -- first chars, for display only
    scope VARCHAR(32) NOT NULL DEFAULT 'agent',
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- ---------------------------------------------------------------------------
-- 2. Which folders count as work.
--
-- Deliberately an allowlist, not a classifier: a wrong guess could put a personal
-- session into a report that goes to a team Slack channel. No path -> not logged,
-- and the hook checks this locally so personal sessions never leave the machine.
--
-- work_paths: [{"path": "/Users/me/Projects", "workspace": "job"}, ...]
-- Longest matching prefix wins, so a sub-folder can override its parent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    work_paths JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. The session ledger.
--
-- Same contract as processed_commits / processed_gmail_messages: it records that a
-- session was *seen*, and outlives the task (task_id ... ON DELETE SET NULL), so
-- deleting the task can never cause a re-import.
--
-- One deliberate difference: the upsert is DO UPDATE, not DO NOTHING. A session
-- legitimately re-reports with *more* work than its first report (a /clear fires
-- SessionEnd mid-session), and DO NOTHING would silently drop everything after the
-- first fire. The day's task is rebuilt from every session row, so re-fires
-- converge instead of duplicating.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    project_slug VARCHAR(255) NOT NULL,   -- folder name; groups a day's sessions
    project_path TEXT,
    workspace VARCHAR(50) NOT NULL DEFAULT 'job',
    summary TEXT,                          -- AI-written, one line
    prompts JSONB DEFAULT '[]'::jsonb,     -- what was asked (the intent)
    changed_paths JSONB DEFAULT '[]'::jsonb,
    started_at BIGINT NOT NULL,            -- epoch ms, matching tasks.completed_at
    ended_at BIGINT NOT NULL,
    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_day
    ON agent_sessions(user_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task
    ON agent_sessions(task_id);

-- Seed settings for existing users so the panel isn't empty on first load.
INSERT INTO agent_settings (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
