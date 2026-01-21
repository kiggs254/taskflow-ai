-- Add workspace tab visibility preferences to users table
-- Run this migration to add the new columns to the users table

DO $$ 
BEGIN
    -- Add show_freelance_tab column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'show_freelance_tab'
    ) THEN
        ALTER TABLE users ADD COLUMN show_freelance_tab BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added show_freelance_tab column to users table';
    ELSE
        RAISE NOTICE 'show_freelance_tab column already exists in users table';
    END IF;

    -- Add show_personal_tab column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'show_personal_tab'
    ) THEN
        ALTER TABLE users ADD COLUMN show_personal_tab BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added show_personal_tab column to users table';
    ELSE
        RAISE NOTICE 'show_personal_tab column already exists in users table';
    END IF;

    -- Add gmail_auto_reply_on_complete column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'gmail_auto_reply_on_complete'
    ) THEN
        ALTER TABLE users ADD COLUMN gmail_auto_reply_on_complete BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added gmail_auto_reply_on_complete column to users table';
    ELSE
        RAISE NOTICE 'gmail_auto_reply_on_complete column already exists in users table';
    END IF;
END $$;
