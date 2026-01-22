-- Migration to track processed Slack messages (prevents recreating deleted tasks)

CREATE TABLE IF NOT EXISTS processed_slack_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_ts VARCHAR(50) NOT NULL,
    channel_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, message_ts, channel_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_processed_slack_user_message 
ON processed_slack_messages(user_id, message_ts);
