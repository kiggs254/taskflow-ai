-- Migration: store the individual things a session did
-- Run: psql -U <user> -d <db> -f migration_add_agent_session_items.sql
--
-- summariseSession used to return one line, which then served as the task title, its
-- only subtask AND its description -- expanding a row just showed the same sentence
-- three more times, with no actual detail. A request like "save submissions in the
-- admin so they can be viewed and exported" contains several distinct deliverables;
-- those are the subtasks. This is where they live.

ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
