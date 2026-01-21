-- Migration: Add filter_prompt column to gmail_integrations
-- Allows users to configure custom instructions (do's and don'ts) for email scanning

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'gmail_integrations'
          AND column_name = 'filter_prompt'
    ) THEN
        ALTER TABLE gmail_integrations ADD COLUMN filter_prompt TEXT;
        RAISE NOTICE 'Added filter_prompt column to gmail_integrations';
    ELSE
        RAISE NOTICE 'filter_prompt column already exists in gmail_integrations';
    END IF;
END $$;
