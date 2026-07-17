-- Migration: GitHub integration (commit -> completed task tracking)
-- Run: psql -U <user> -d <db> -f migration_add_github_integration.sql

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
