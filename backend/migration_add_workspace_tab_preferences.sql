-- Add workspace tab visibility preferences to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_freelance_tab BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_personal_tab BOOLEAN DEFAULT false;
