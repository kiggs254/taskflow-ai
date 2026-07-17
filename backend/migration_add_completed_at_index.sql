-- Migration: index tasks by completion time
-- Run: psql -U <user> -d <db> -f migration_add_completed_at_index.sql
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
