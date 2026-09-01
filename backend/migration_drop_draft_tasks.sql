-- Migration: drop draft_tasks
-- Run AFTER migration_add_email_proposals.sql, and after deploying the code that
-- stops reading it (kpiService now sources arrivals from the message ledgers, and the
-- analytics screen that read approve/reject counts is gone).
--
-- Nothing is lost that matters: draft rows were AI guesses about mail, and the
-- immutable processed_gmail_messages ledger -- which records every message handled --
-- is untouched.

DROP TABLE IF EXISTS draft_tasks;
