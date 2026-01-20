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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
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

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Comments for documentation
COMMENT ON TABLE users IS 'User accounts with gamification stats';
COMMENT ON TABLE tasks IS 'User tasks with metadata and AI-generated fields';
COMMENT ON COLUMN tasks.tags IS 'JSON array of tag strings';
COMMENT ON COLUMN tasks.dependencies IS 'JSON array of task IDs this task depends on';
COMMENT ON COLUMN tasks.recurrence IS 'JSON object with frequency and interval for recurring tasks';
