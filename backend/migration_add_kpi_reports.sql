-- Migration: store generated monthly KPI reports
-- Run: psql -U <user> -d <db> -f migration_add_kpi_reports.sql
--
-- Building a report walks every selected repo's branches on GitHub, so regenerating it
-- on each page view was slow and burned API budget for an answer that had not changed.
--
-- Storing it also makes a submitted report reproducible: the figures a manager was sent
-- stay exactly as sent, even though the underlying git history can move under it (a
-- force-push, a branch deleted). Rebuild is then an explicit act, not a side effect of
-- opening a page.

CREATE TABLE IF NOT EXISTS kpi_reports (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month        CHAR(7) NOT NULL,              -- 'YYYY-MM'
    report       JSONB NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, month)
);
