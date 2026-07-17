-- Migration: key agent sessions per DAY, not just per session
-- Run: psql -U <user> -d <db> -f migration_add_agent_session_day.sql
--
-- A Claude Code session_id is stable across resumes, and resuming an old session is
-- the normal way to work. With UNIQUE(user_id, session_id) that broke:
--
--   Mon: session S does work -> row(S), ended_at=Mon -> Monday's task
--   Wed: resume S, more work -> ON CONFLICT DO UPDATE rewrites the SAME row,
--        moving ended_at to Wed
--
-- Monday's work is then gone from the ledger: the row now sits in Wednesday's window,
-- so Monday's task is no longer backed by any session. It stops being rebuilt, and
-- the report's `fromAgent` join for Monday finds nothing -- so a day of real work
-- silently stops counting toward the 16:30 gate.
--
-- Keying on (user_id, session_id, day) gives each day of a long-running session its
-- own row. Both cases then behave:
--   - /clear fires SessionEnd mid-session, same day -> updates that day's row
--   - resume tomorrow -> a new row for tomorrow, yesterday's stays intact

ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS day VARCHAR(10);

-- Backfill from ended_at. UTC is close enough here: these rows are hours old and the
-- column only groups a session's chunks, so a boundary case costs nothing.
UPDATE agent_sessions
SET day = to_char(to_timestamp(ended_at / 1000.0), 'YYYY-MM-DD')
WHERE day IS NULL;

ALTER TABLE agent_sessions ALTER COLUMN day SET NOT NULL;

-- Swap the constraint. The old name is Postgres's default for UNIQUE(user_id, session_id).
ALTER TABLE agent_sessions DROP CONSTRAINT IF EXISTS agent_sessions_user_id_session_id_key;
DROP INDEX IF EXISTS agent_sessions_user_id_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_user_session_day
    ON agent_sessions(user_id, session_id, day);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_day
    ON agent_sessions(user_id, project_slug, day);
