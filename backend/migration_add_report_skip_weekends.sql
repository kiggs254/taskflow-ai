-- Migration: don't send the daily report on Saturday or Sunday
-- Run: psql -U <user> -d <db> -f migration_add_report_skip_weekends.sql
--
-- Defaults to true: this is a work report going to a team channel, and a weekend post
-- is noise for everyone in it.
--
-- There is no "queue it for Monday" mechanism and none is needed. The sweep simply
-- doesn't claim on Sat/Sun, so last_sent_at stays at Friday's send, and Monday's
-- window -- which runs from the last send, not from midnight -- already covers the
-- weekend. Weekend work therefore appears in Monday's report as a consequence of the
-- window, not of a special case. Friday->Monday is 3 days, inside the 7-day clamp.

ALTER TABLE user_report_settings ADD COLUMN IF NOT EXISTS skip_weekends BOOLEAN DEFAULT true;

COMMENT ON COLUMN user_report_settings.skip_weekends IS
  'Skip Sat/Sun sends. Weekend work still reports on Monday: the window runs from the last send, so nothing is lost by not sending.';
