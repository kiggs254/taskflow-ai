-- Migration: enforce one draft per source message
-- Run: psql -U <user> -d <db> -f migration_add_draft_tasks_source_unique.sql
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
