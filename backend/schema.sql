-- PostgreSQL Schema for TaskFlow.AI
-- Migration from MySQL to PostgreSQL

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak INTEGER DEFAULT 0,
    last_active_date DATE,
    last_reset_at TIMESTAMP WITH TIME ZONE,
    telegram_user_id BIGINT,
    gmail_connected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    workspace VARCHAR(50),
    energy VARCHAR(50),
    status VARCHAR(50) DEFAULT 'todo',
    estimated_time INTEGER,
    tags JSONB DEFAULT '[]'::jsonb,
    dependencies JSONB DEFAULT '[]'::jsonb,
    recurrence JSONB,
    created_at BIGINT NOT NULL,
    completed_at BIGINT,
    due_date BIGINT,
    snoozed_until BIGINT,
    original_recurrence_id VARCHAR(255),
    created_at_db TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Gmail integrations table
CREATE TABLE IF NOT EXISTS gmail_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_scan_at TIMESTAMP WITH TIME ZONE,
    scan_frequency INTEGER DEFAULT 60,
    filter_prompt TEXT,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, email)
);

-- Draft tasks table (tasks extracted from Gmail/Telegram pending approval)
CREATE TABLE IF NOT EXISTS draft_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    source_id VARCHAR(255),
    title TEXT NOT NULL,
    description TEXT,
    workspace VARCHAR(50),
    energy VARCHAR(50),
    estimated_time INTEGER,
    tags JSONB DEFAULT '[]'::jsonb,
    due_date BIGINT,
    status VARCHAR(50) DEFAULT 'pending',
    ai_confidence FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Telegram integrations table
CREATE TABLE IF NOT EXISTS telegram_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL,
    telegram_username VARCHAR(255),
    chat_id BIGINT NOT NULL,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notifications_enabled BOOLEAN DEFAULT true,
    daily_summary_time TIME,
    UNIQUE(user_id),
    UNIQUE(telegram_user_id)
);

-- Slack integrations table
CREATE TABLE IF NOT EXISTS slack_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slack_user_id VARCHAR(255) NOT NULL,
    slack_team_id VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_scan_at TIMESTAMP WITH TIME ZONE,
    scan_frequency INTEGER DEFAULT 15,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id),
    UNIQUE(slack_user_id, slack_team_id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_gmail_integrations_user_id ON gmail_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_tasks_user_id ON draft_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_tasks_status ON draft_tasks(status);
CREATE INDEX IF NOT EXISTS idx_telegram_integrations_user_id ON telegram_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_integrations_telegram_user_id ON telegram_integrations(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_slack_integrations_user_id ON slack_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_slack_integrations_slack_user_id ON slack_integrations(slack_user_id);

-- Comments for documentation
COMMENT ON TABLE users IS 'User accounts with gamification stats';
COMMENT ON TABLE tasks IS 'User tasks with metadata and AI-generated fields';
COMMENT ON COLUMN tasks.tags IS 'JSON array of tag strings';
COMMENT ON COLUMN tasks.dependencies IS 'JSON array of task IDs this task depends on';
COMMENT ON COLUMN tasks.recurrence IS 'JSON object with frequency and interval for recurring tasks';
COMMENT ON TABLE gmail_integrations IS 'Gmail OAuth2 integrations for email scanning';
COMMENT ON TABLE draft_tasks IS 'Tasks extracted from Gmail/Telegram/Slack pending user approval';
COMMENT ON TABLE telegram_integrations IS 'Telegram bot account linkages and notification settings';
COMMENT ON TABLE slack_integrations IS 'Slack OAuth2 integrations for monitoring mentions and creating tasks';