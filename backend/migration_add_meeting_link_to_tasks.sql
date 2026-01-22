-- Migration to add meeting_link column to tasks table

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS meeting_link TEXT;

-- Optional: Add index for tasks with meeting links (useful for meeting views)
CREATE INDEX IF NOT EXISTS idx_tasks_meeting_link ON tasks(user_id) WHERE meeting_link IS NOT NULL;
