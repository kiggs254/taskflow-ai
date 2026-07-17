-- Migration: record WHEN the report was sent, not just which day it was sent for
-- Run: psql -U <user> -d <db> -f migration_add_report_last_sent_at.sql
--
-- last_sent_on is a DATE, which is all the idempotency guard needed: "have I sent
-- today's report yet". But it can't answer "where should the next report start",
-- and anchoring the window to local midnight instead meant work finished after the
-- 16:30 send belonged to a day whose report had already gone out. Tomorrow's report
-- only looks at tomorrow, so evening work landed in a 7.5-hour hole and appeared in
-- no report at all -- not deferred, dropped.
--
-- With the exact send timestamp, consecutive reports partition time exactly: each one
-- covers (last send, now], so after-hours work rolls into the next day's report and
-- nothing is counted twice.
--
-- Backfilled to last_sent_on at the report time, which is when those sends actually
-- happened (the sweep only fires within 5 minutes of it). NULL stays NULL and falls
-- back to midnight, so a user who has never had a report doesn't get a backlog dump
-- on their first one.

ALTER TABLE user_report_settings ADD COLUMN IF NOT EXISTS last_sent_at BIGINT;

UPDATE user_report_settings
SET last_sent_at = EXTRACT(EPOCH FROM ((last_sent_on + report_time) AT TIME ZONE timezone)) * 1000
WHERE last_sent_on IS NOT NULL AND last_sent_at IS NULL;

COMMENT ON COLUMN user_report_settings.last_sent_at IS
  'Epoch ms of the last send. The next report''s window starts here, so that after-hours work rolls forward instead of falling between two reports.';
