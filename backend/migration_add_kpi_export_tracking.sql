-- Migration: track the last month auto-exported to Google Sheets
-- Run: psql -U <user> -d <db> -f migration_add_kpi_export_tracking.sql
--
-- Claimed before the export runs, exactly like user_report_settings.last_sent_on: the
-- sweep re-fires on every restart and redeploy, and writing the same tab twice is
-- harmless but re-deriving it from GitHub each time is not free. At-most-once.

ALTER TABLE kpi_settings ADD COLUMN IF NOT EXISTS last_exported_month CHAR(7);

COMMENT ON COLUMN kpi_settings.last_exported_month IS
  'YYYY-MM of the last month written to Sheets automatically. Claimed before the write.';
