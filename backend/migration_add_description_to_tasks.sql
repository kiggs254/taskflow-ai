-- Migration: Add description column to tasks table
-- Run this migration if the tasks table doesn't have a description column

-- Check if column exists, if not add it
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE tasks ADD COLUMN description TEXT;
        RAISE NOTICE 'Added description column to tasks table';
    ELSE
        RAISE NOTICE 'Description column already exists in tasks table';
    END IF;
END $$;
