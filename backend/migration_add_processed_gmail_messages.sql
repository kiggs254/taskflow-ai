-- Migration: track processed Gmail messages (stops the same email recreating tasks)
-- Run: psql -U <user> -d <db> -f migration_add_processed_gmail_messages.sql
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
