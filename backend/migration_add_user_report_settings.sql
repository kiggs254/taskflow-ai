-- Migration: per-user daily report settings
-- Run: psql -U <user> -d <db> -f migration_add_user_report_settings.sql
--
-- `daily_report_enabled` lived on slack_integrations, which was the wrong home:
--   1. it is a report setting living on a *connection* table;
--   2. email has no equivalent table to hang a flag on, so a multi-channel setting
--      would be split across two places, one of which doesn't exist;
--   3. disconnecting Slack deleted the row, silently resetting the preference;
--   4. no server-side code ever read it -- the only consumer was the frontend, so
--      the "daily report" only fired if the user happened to open the app and run a
--      manual daily reset. It was never actually scheduled.

CREATE TABLE IF NOT EXISTS user_report_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
    report_time TIME NOT NULL DEFAULT '16:30',
    email_enabled BOOLEAN DEFAULT true,
    slack_enabled BOOLEAN DEFAULT true,
    -- Was hardcoded to 'tech-team-daily-tasks' in slackService, which *threw* if the
    -- channel didn't exist -- so any user not in that one workspace got an exception
    -- instead of a report.
    slack_channel VARCHAR(255) DEFAULT 'tech-team-daily-tasks',
    -- Only send on days with commits.
    require_commits BOOLEAN DEFAULT true,
    -- Idempotency guard: the local date the report was last sent for. Claimed
    -- atomically before sending so a redeploy or a second instance cannot
    -- double-post into a team channel.
    last_sent_on DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Carry over the existing Slack preference so nobody's setting silently flips.
--
-- Guarded: slack_integrations.daily_report_enabled is itself added by
-- migration_add_daily_report_enabled.sql, and migrations here are run manually and
-- individually. A plain reference would make this file fail outright on a database
-- built from schema.sql alone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slack_integrations' AND column_name = 'daily_report_enabled'
  ) THEN
    INSERT INTO user_report_settings (user_id, slack_enabled)
    SELECT user_id, COALESCE(daily_report_enabled, true)
    FROM slack_integrations
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'slack_integrations'
  ) THEN
    INSERT INTO user_report_settings (user_id)
    SELECT user_id FROM slack_integrations
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_report_settings_sweep
    ON user_report_settings(report_time)
    WHERE email_enabled = true OR slack_enabled = true;
