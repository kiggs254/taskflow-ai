-- Migration: Add notifications_enabled column to slack_integrations table
-- Run this migration if the slack_integrations table doesn't have a notifications_enabled column

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'slack_integrations'
          AND column_name = 'notifications_enabled'
    ) THEN
        ALTER TABLE slack_integrations ADD COLUMN notifications_enabled BOOLEAN DEFAULT true;
        RAISE NOTICE 'Added notifications_enabled column to slack_integrations';
    ELSE
        RAISE NOTICE 'notifications_enabled column already exists in slack_integrations';
    END IF;
END $$;
