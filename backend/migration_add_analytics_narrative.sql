-- Migration: cache for AI-generated analytics narratives
-- Run: psql -U <user> -d <db> -f migration_add_analytics_narrative.sql
--
-- Without this, every visit to the Analytics tab is a smart-tier model call. Keyed by
-- (range, local date) so it regenerates once a day per range.

CREATE TABLE IF NOT EXISTS analytics_narrative (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_key VARCHAR(64) NOT NULL,   -- '<range>:<YYYY-MM-DD>'
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, cache_key)
);

-- Old entries are never read again; safe to prune.
CREATE INDEX IF NOT EXISTS idx_analytics_narrative_created
    ON analytics_narrative(created_at);
