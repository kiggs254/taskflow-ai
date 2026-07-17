-- Migration: remove GitHub tasks left behind by the task-id change
-- Run: psql -U <user> -d <db> -f migration_fix_duplicate_github_tasks.sql
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

BEGIN;

-- What's about to be removed. Old format = exactly two segments after 'gh-'
-- (repoId-date); new format has three (userId-repoId-date).
\echo ''
\echo '--- Orphaned old-format GitHub tasks (these will be deleted) ---'
SELECT id, user_id, title, to_timestamp(completed_at/1000) AS completed
FROM tasks
WHERE id ~ '^gh-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ORDER BY completed_at DESC;

\echo ''
\echo '--- Live new-format tasks (kept, and rebuilt on every scan) ---'
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

COMMIT;

\echo ''
\echo '--- After: one GitHub task per repo per day ---'
SELECT id, title FROM tasks WHERE id LIKE 'gh-%' ORDER BY id;
