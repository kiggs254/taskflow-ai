-- Migration: Add prompt_instructions column to gmail_integrations

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'gmail_integrations'
          AND column_name = 'prompt_instructions'
    ) THEN
        ALTER TABLE gmail_integrations ADD COLUMN prompt_instructions TEXT;
        RAISE NOTICE 'Added prompt_instructions column to gmail_integrations';
    ELSE
        RAISE NOTICE 'prompt_instructions column already exists in gmail_integrations';
    END IF;
END $$;
