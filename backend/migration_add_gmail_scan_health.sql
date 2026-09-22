-- Migration: make a failing Gmail scan visible.
-- Run: psql -U <user> -d <db> -f migration_add_gmail_scan_health.sql
--
-- last_scan_at is the CURSOR: it is the `after:` term of the next Gmail query, and it
-- is advanced only when a scan succeeds. That is correct -- advancing it on failure
-- would skip every mail that arrived during the outage, permanently -- but it means a
-- scanner that has been throwing for sixteen hours looks exactly like an inbox that has
-- been quiet for sixteen hours. The UI read "last checked 23:55:02" all the following
-- day and said "Nothing waiting."
--
-- These columns separate "when did we last SUCCEED" from "when did we last TRY, and what
-- happened". Nothing else may be inferred from a stale cursor.

ALTER TABLE gmail_integrations
    -- Every attempt, successful or not. Advances even when the scan throws.
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE,
    -- The failure message from the most recent attempt, NULL once one succeeds.
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    -- How many attempts in a row have failed, so the UI can say "since when".
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
