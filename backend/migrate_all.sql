-- ============================================================================
-- TaskFlow.AI - consolidated migration
-- Run once:  psql -U <user> -d <db> -f migrate_all.sql
--
-- All statements are idempotent and safe to re-run. Wrapped in a transaction, so
-- either every change lands or none of them do.
--
-- The Gmail section BACKFILLS the dedup ledger from your existing drafts/tasks.
-- That is not optional: with an empty ledger every historical email looks
-- unprocessed, and the first scan would recreate every task you have ever had
-- from Gmail at once.
-- ============================================================================

BEGIN;


-- ---------------------------------------------------------------------------
-- migration_add_subtasks_to_tasks.sql
-- ---------------------------------------------------------------------------
-- Migration to add subtasks column to tasks table
-- Run this migration to enable subtask functionality

-- Add subtasks column (JSONB array to store subtask objects)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]'::jsonb;

-- Create index for efficient querying of tasks with subtasks
CREATE INDEX IF NOT EXISTS idx_tasks_subtasks ON tasks USING GIN (subtasks);

-- Example subtask structure:
-- [
--   {
--     "id": "subtask-1234567890-0",
--     "title": "Review the proposal",
--     "completed": false,
--     "completedAt": null
--   },
--   {
--     "id": "subtask-1234567890-1", 
--     "title": "Send feedback to client",
--     "completed": true,
--     "completedAt": 1706000000000
--   }
-- ]

-- ---------------------------------------------------------------------------
-- migration_add_processed_gmail_messages.sql
-- ---------------------------------------------------------------------------
-- Migration: track processed Gmail messages (stops the same email recreating tasks)
--
-- WHY
-- Slack already had this (processed_slack_messages): an immutable ledger of what
-- has been seen, independent of whether the resulting task still exists. Gmail had
-- no equivalent -- it answered "did I already process this email?" by asking "does a
-- draft or task for it still exist?". That answer flips back to "no" the moment the
-- user rejects the draft, deletes the draft, or deletes the task, and the next scan
-- recreates it. Rejecting a draft was the worst case: the user's explicit "no" was
-- exactly what re-armed the bug.
--
-- Four leaks this closes:
--   1. rejectDraftTask sets status='rejected', but draftTaskExists only matched
--      ('pending','approved') -- so rejection guaranteed the task came back.
--   2. deleteDraftTask hard-deletes the row; the guard disappears with it.
--   3. deleteTask hard-deletes; taskExistsForSource then returns false.
--   4. The "looks like a meeting" path created a task via syncTask and never wrote
--      a draft_tasks row at all, so its only dedup trace was an HTML comment
--      embedded in the task description.
--
-- The ledger is keyed on the Gmail message id and never deleted, so it stays true
-- regardless of what happens to the task afterwards.

CREATE TABLE IF NOT EXISTS processed_gmail_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id VARCHAR(255) NOT NULL,
    -- Nullable + ON DELETE SET NULL: the ledger must outlive the task it created.
    -- This is the property that makes the whole thing work.
    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE SET NULL,
    outcome VARCHAR(32),  -- 'task' | 'draft' | 'irrelevant'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_gmail_user_message
    ON processed_gmail_messages(user_id, message_id);

-- ---------------------------------------------------------------------------
-- BACKFILL -- do not skip.
--
-- On an existing database the ledger starts empty, which means every historical
-- email is "unprocessed" and the first scan after deploy would recreate every task
-- the user has ever had from Gmail, all at once. That would ship the bug's worst
-- possible occurrence as its own fix. Seed from what we already know.
-- ---------------------------------------------------------------------------

-- 1. Every draft ever created from Gmail, in ANY status. Including 'rejected' is
--    the entire point: a rejected draft must never be recreated.
INSERT INTO processed_gmail_messages (user_id, message_id, outcome)
SELECT DISTINCT ON (user_id, source_id) user_id, source_id, 'draft'
FROM draft_tasks
WHERE source = 'gmail' AND source_id IS NOT NULL
ORDER BY user_id, source_id, id
ON CONFLICT (user_id, message_id) DO NOTHING;

-- 2. Tasks created directly from an email (the meeting path). Those carry their
--    provenance only in an HTML comment: <!-- Email metadata: {"messageId":"..."} -->
INSERT INTO processed_gmail_messages (user_id, message_id, task_id, outcome)
SELECT DISTINCT ON (user_id, message_id) user_id, message_id, task_id, 'task'
FROM (
    SELECT
        user_id,
        id AS task_id,
        (regexp_match(description, '"messageId"\s*:\s*"([^"]+)"'))[1] AS message_id
    FROM tasks
    WHERE description LIKE '%messageId%'
) extracted
WHERE message_id IS NOT NULL
ORDER BY user_id, message_id, task_id
ON CONFLICT (user_id, message_id) DO NOTHING;

-- Sanity check after running:
--   SELECT outcome, count(*) FROM processed_gmail_messages GROUP BY outcome;
-- Expect roughly one row per historical Gmail-sourced draft/task. If this comes back
-- empty on a database that has Gmail history, STOP and investigate before enabling
-- the scanner -- an empty ledger means the next scan re-imports everything.

-- ---------------------------------------------------------------------------
-- migration_add_draft_tasks_source_unique.sql
-- ---------------------------------------------------------------------------
-- Migration: enforce one draft per source message
-- Run AFTER migration_add_processed_gmail_messages.sql.
--
-- draft_tasks.source_id had no unique constraint, so dedup was a read-then-write
-- check ("does a draft exist?" ... then insert) with a race in between. Two scans
-- overlapping -- which is easy, since the scanner cron fires every minute and a slow
-- scan can still be running -- both see "no draft" and both insert.
--
-- The processed_* ledger is the primary defence; this is the database-level backstop
-- that makes duplicate drafts structurally impossible rather than merely unlikely.

-- Collapse any existing duplicates first, keeping the earliest row per source
-- message. Approved/pending drafts win over rejected ones so we don't resurrect a
-- rejection by deleting the wrong duplicate.
DELETE FROM draft_tasks d
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, source, source_id
               ORDER BY
                   CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                   id
           ) AS rn
    FROM draft_tasks
    WHERE source_id IS NOT NULL
) dup
WHERE d.id = dup.id AND dup.rn > 1;

-- Partial: source_id is nullable and NULLs are not duplicates of each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_tasks_source_unique
    ON draft_tasks(user_id, source, source_id)
    WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- migration_add_completed_at_index.sql
-- ---------------------------------------------------------------------------
-- Migration: index tasks by completion time
--
-- schema.sql indexes user_id, status and created_at, but nothing on completed_at.
-- Every "what did I finish today" query -- the daily report job, the analytics
-- aggregation endpoint, the existing daily summary -- filters on
-- (user_id, completed_at) with status = 'done' and was doing so unindexed.
--
-- Partial on status = 'done' because completed_at is NULL for everything else,
-- which keeps the index small.

CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_at
    ON tasks(user_id, completed_at DESC)
    WHERE status = 'done';

-- ---------------------------------------------------------------------------
-- migration_add_ai_usage.sql
-- ---------------------------------------------------------------------------
-- Migration: AI usage / cost telemetry
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

-- ---------------------------------------------------------------------------
-- migration_add_github_integration.sql
-- ---------------------------------------------------------------------------
-- Migration: GitHub integration (commit -> completed task tracking)

CREATE TABLE IF NOT EXISTS github_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_user_id BIGINT,
    github_login VARCHAR(255),
    -- 'github_app' (installation token, read-only, scoped to picked repos) or
    -- 'oauth_app' (user token). Kept as a column so the auth strategy can change
    -- without a migration.
    auth_kind VARCHAR(20) NOT NULL DEFAULT 'github_app',
    installation_id BIGINT,
    access_token TEXT,          -- encrypted; oauth_app path only
    refresh_token TEXT,         -- encrypted
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_scan_at TIMESTAMP WITH TIME ZONE,
    scan_frequency INTEGER DEFAULT 30,   -- minutes
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS github_repos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- GitHub's numeric id, not owner/name: repos get renamed, and keying on the
    -- name would make a rename look like a brand new repo and re-ingest its history.
    repo_id BIGINT NOT NULL,
    owner VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    default_branch VARCHAR(255),
    selected BOOLEAN DEFAULT false,
    etag VARCHAR(255),                  -- conditional-request cache; 304s are free
    last_polled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, repo_id)
);

-- Immutable ledger of ingested commits. Same contract as processed_gmail_messages /
-- processed_slack_messages: it records that a commit was *seen*, and survives the
-- task being deleted, so a commit is never ingested twice.
CREATE TABLE IF NOT EXISTS processed_commits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id BIGINT NOT NULL,
    sha VARCHAR(40) NOT NULL,
    committed_at BIGINT NOT NULL,       -- epoch ms, matching tasks.completed_at
    message TEXT,
    html_url TEXT,
    branch VARCHAR(255),
    -- SET NULL, not CASCADE: the ledger must outlive the task.
    task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, repo_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_processed_commits_user_day
    ON processed_commits(user_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_processed_commits_task
    ON processed_commits(task_id);
CREATE INDEX IF NOT EXISTS idx_github_repos_user_selected
    ON github_repos(user_id) WHERE selected = true;
CREATE INDEX IF NOT EXISTS idx_github_integrations_user_id
    ON github_integrations(user_id);

-- ---------------------------------------------------------------------------
-- migration_add_user_report_settings.sql
-- ---------------------------------------------------------------------------
-- Migration: per-user daily report settings
--
-- `daily_report_enabled` lived on slack_integrations, which was the wrong home:
--   1. it is a report setting living on a *connection* table;
--   2. email has no equivalent table to hang a flag on, so a multi-channel setting
--      would be split across two places, one of which doesn't exist;
--   3. disconnecting Slack deleted the row, silently resetting the preference;
--   4. no server-side code ever read it -- the only consumer was the frontend, so
--      the "daily report" only fired if the user happened to open the app and run a
--      manual daily reset. It was never actually scheduled.

CREATE TABLE IF NOT EXISTS user_report_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
    report_time TIME NOT NULL DEFAULT '16:30',
    email_enabled BOOLEAN DEFAULT true,
    slack_enabled BOOLEAN DEFAULT true,
    -- Was hardcoded to 'tech-team-daily-tasks' in slackService, which *threw* if the
    -- channel didn't exist -- so any user not in that one workspace got an exception
    -- instead of a report.
    slack_channel VARCHAR(255) DEFAULT 'tech-team-daily-tasks',
    -- Only send on days with commits.
    require_commits BOOLEAN DEFAULT true,
    -- Idempotency guard: the local date the report was last sent for. Claimed
    -- atomically before sending so a redeploy or a second instance cannot
    -- double-post into a team channel.
    last_sent_on DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Carry over the existing Slack preference so nobody's setting silently flips.
--
-- Guarded: slack_integrations.daily_report_enabled is itself added by
-- migration_add_daily_report_enabled.sql, and migrations here are run manually and
-- individually. A plain reference would make this file fail outright on a database
-- built from schema.sql alone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slack_integrations' AND column_name = 'daily_report_enabled'
  ) THEN
    INSERT INTO user_report_settings (user_id, slack_enabled)
    SELECT user_id, COALESCE(daily_report_enabled, true)
    FROM slack_integrations
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'slack_integrations'
  ) THEN
    INSERT INTO user_report_settings (user_id)
    SELECT user_id FROM slack_integrations
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_report_settings_sweep
    ON user_report_settings(report_time)
    WHERE email_enabled = true OR slack_enabled = true;

-- ---------------------------------------------------------------------------
-- migration_add_analytics_narrative.sql
-- ---------------------------------------------------------------------------
-- Migration: cache for AI-generated analytics narratives
--
-- Without this, every visit to the Analytics tab is a smart-tier model call. Keyed by
-- (range, local date) so it regenerates once a day per range.

CREATE TABLE IF NOT EXISTS analytics_narrative (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_key VARCHAR(64) NOT NULL,   -- '<range>:<YYYY-MM-DD>'
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, cache_key)
);

-- Old entries are never read again; safe to prune.
CREATE INDEX IF NOT EXISTS idx_analytics_narrative_created
    ON analytics_narrative(created_at);

-- ---------------------------------------------------------------------------
-- migration_add_agent_logging.sql
-- ---------------------------------------------------------------------------
-- Migration: log work done in an external agent (Claude Code) as completed tasks
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

-- ---------------------------------------------------------------------------
-- migration_fix_duplicate_github_tasks.sql
-- ---------------------------------------------------------------------------
-- Migration: remove GitHub tasks left behind by the task-id change
--
-- GitHub task ids changed from `gh-{repoId}-{date}` to `gh-{userId}-{repoId}-{date}`
-- so that two users tracking the same repo can't overwrite each other's task
-- (repo_id is GitHub's global id, and syncTask's conflict target is the id alone).
--
-- That change was made on the understanding that no gh- tasks existed yet, which was
-- true when it was checked and no longer true when it deployed. The result: each
-- repo-day now has an orphaned old-format task alongside the live new-format one,
-- showing up as "taskflow-ai — 5 commits" next to "taskflow-ai — 6 commits".
--
-- The new-format task is authoritative: it's rebuilt from processed_commits on every
-- scan, so it holds the complete day. The old-format one is frozen at whatever the
-- last pre-change scan saw and will never update again.


-- What's about to be removed. Old format = exactly two segments after 'gh-'
-- (repoId-date); new format has three (userId-repoId-date).
SELECT id, user_id, title, to_timestamp(completed_at/1000) AS completed
FROM tasks
WHERE id ~ '^gh-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ORDER BY completed_at DESC;

SELECT id, user_id, title, to_timestamp(completed_at/1000) AS completed
FROM tasks
WHERE id ~ '^gh-[0-9]+-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ORDER BY completed_at DESC;

-- Detach the ledger first. processed_commits.task_id is ON DELETE SET NULL, so this
-- is what would happen anyway -- doing it explicitly keeps the intent obvious. The
-- SHAs stay recorded, so nothing is re-ingested; the next scan simply re-points them
-- at the new-format task.
UPDATE processed_commits
SET task_id = NULL
WHERE task_id ~ '^gh-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$';

DELETE FROM tasks
WHERE id ~ '^gh-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$';


SELECT id, title FROM tasks WHERE id LIKE 'gh-%' ORDER BY id;

COMMIT;

-- ============================================================================
-- Post-migration sanity check. Run this and read the output.
-- ============================================================================
\echo ''
\echo '--- Gmail dedup ledger (MUST be non-empty if you have Gmail history) ---'
SELECT COALESCE(outcome, 'none') AS outcome, count(*) AS rows
FROM processed_gmail_messages GROUP BY outcome;

\echo ''
\echo '--- New tables (expect 6) ---'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('processed_gmail_messages','ai_usage','github_integrations',
                     'github_repos','processed_commits','user_report_settings',
                     'analytics_narrative')
ORDER BY table_name;

\echo ''
\echo '--- Report settings (one row per user with Slack; defaults 16:30 Africa/Nairobi) ---'
SELECT user_id, timezone, report_time, email_enabled, slack_enabled, require_commits
FROM user_report_settings;
