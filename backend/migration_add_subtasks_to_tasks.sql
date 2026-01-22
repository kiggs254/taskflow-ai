finsi-- Migration to add subtasks column to tasks table
-- Run this migration to enable subtask functionality

-- Add subtasks column (JSONB array to store subtask objects)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]'::jsonb;

-- Create index for efficient querying of tasks with subtasks
CREATE INDEX IF NOT EXISTS idx_tasks_subtasks ON tasks USING GIN (subtasks);

-- Example subtask structure:
-- [
--   {
--     "id": "subtask-1234567890-0",
--     "title": "Review the proposal",
--     "completed": false,
--     "completedAt": null
--   },
--   {
--     "id": "subtask-1234567890-1", 
--     "title": "Send feedback to client",
--     "completed": true,
--     "completedAt": 1706000000000
--   }
-- ]
