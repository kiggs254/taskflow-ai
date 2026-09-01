-- Migration: email proposals replace draft tasks
-- Run: psql -U <user> -d <db> -f migration_add_email_proposals.sql
--
-- The assistant reads a thread, decides whether it needs a human reply, and when it does
-- proposes a draft. Nothing is created for mail that needs no reply -- which is the
-- opposite of the draft-task pipeline, where "not a task" had no way to be expressed and
-- every automated receipt became a row.
--
-- Keyed on THREAD, not message. The old pipeline processed each new message
-- independently, so three new messages in one conversation produced three near-identical
-- drafts. One row per thread, updated as the thread moves, is the fix.

CREATE TABLE IF NOT EXISTS email_proposals (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id       VARCHAR(255) NOT NULL,
    last_message_id VARCHAR(255),
    subject         TEXT,
    from_address    TEXT,
    -- What the assistant concluded, and why. `reasoning` is kept even for threads it
    -- decided to leave alone, so a miss can be reviewed rather than being invisible.
    classification  VARCHAR(64),
    summary         TEXT,
    reasoning       TEXT,
    draft_reply     TEXT,
    -- pending  : waiting for the human
    -- sent     : the draft (possibly edited) was sent
    -- dismissed: explicitly waved away
    status          VARCHAR(32) NOT NULL DEFAULT 'pending',
    thread_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_email_proposals_pending
    ON email_proposals(user_id, updated_at DESC) WHERE status = 'pending';
