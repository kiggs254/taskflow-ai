-- Migration to add daily_report_enabled column to slack_integrations

ALTER TABLE slack_integrations
ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN DEFAULT true;
