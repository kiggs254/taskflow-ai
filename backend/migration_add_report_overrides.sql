-- Migration: let a completed item's report wording be corrected by hand.
-- Run: psql -U <user> -d <db> -f migration_add_report_overrides.sql
--
-- The heading and paragraph in the daily report are both derived: the heading from
-- splitProjectTitle(tasks.title), the paragraph written by AI in narrateItem. Neither is
-- editable, and neither survives being edited:
--
--   * a GitHub or agent task is REBUILT by syncTask on every scan and every re-flush, so
--     an edit to tasks.title is overwritten the next time the scanner runs;
--   * the narrative is regenerated from the subtasks, and End Day Reset passes
--     refresh:true, which deliberately re-writes it.
--
-- So a correction has to live somewhere nothing regenerates. These two columns are
-- exactly that: syncTask's ON CONFLICT list does not mention them, so a rebuild leaves
-- them alone, and attachNarratives prefers them over anything it would otherwise derive
-- -- including under refresh. NULL means "no correction, derive it as usual"; they are
-- never written by any automatic path.

ALTER TABLE tasks
    -- Replaces the bold heading (the `project` half of the title).
    ADD COLUMN IF NOT EXISTS report_title TEXT,
    -- Replaces the paragraph under it, and skips the AI call entirely.
    ADD COLUMN IF NOT EXISTS report_narrative TEXT;
