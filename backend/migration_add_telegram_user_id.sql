-- Migration: Add telegram_user_id column to users table
-- Run this if you get "column telegram_user_id does not exist" error

-- Add telegram_user_id column (nullable, as it's optional)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;

-- Add index for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id);

-- Add gmail_connected column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN DEFAULT false;
