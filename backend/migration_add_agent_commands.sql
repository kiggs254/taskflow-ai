-- Migration: record the shell commands a Claude Code session ran.
-- Run: psql -U <user> -d <db> -f migration_add_agent_commands.sql
--
-- Most work never touches Edit/Write. A plugin written with a heredoc, a WP-CLI call,
-- a deploy -- all of it was invisible, so a session could record zero files and its
-- summary could only ever describe what was *asked for*, never what was built. Two
-- real sessions did exactly that: both produced a plugin, and both summaries read as
-- if nothing had been made.
--
-- Commands are redacted on the machine before they are sent (see the `redact` function
-- in agent-hooks/taskflow-record.mjs) -- credentials never reach this column, and are
-- never written to the local session log either.
--
-- Stored rather than used and discarded so /api/agent/resummarise can replay a session
-- with the same evidence the original summary had. Without this, re-running a summary
-- would quietly produce a worse one than the first attempt.

ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS commands JSONB DEFAULT '[]'::jsonb;
