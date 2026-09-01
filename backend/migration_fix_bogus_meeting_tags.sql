-- Migration: strip the meeting tags and due dates the broken detector invented
-- Run: psql -U <user> -d <db> -f migration_fix_bogus_meeting_tags.sql
--
-- The old Gmail scanner decided an email was an event with an unanchored substring match
-- over the entire raw body ('meeting', 'invite', 'event', 'calendar'). Footers, signatures
-- and quoted history matched constantly -- 'event' even matches "prevent" -- so the tag
-- landed on most mail. Worse, when it matched it set due_date to the email's own Date
-- header, i.e. when the mail was SENT, and the UI rendered that as "Meeting Time: ...".
--
-- Every 'meeting' tag on a Gmail-sourced task came from that branch and none of the due
-- dates were real meeting times, so both are removed. The tasks themselves are left
-- alone -- only the two fields that were fabricated are cleared.

UPDATE tasks
   SET tags = COALESCE((
         SELECT jsonb_agg(t) FROM jsonb_array_elements(tags) AS t
          WHERE t <> '"meeting"'::jsonb
       ), '[]'::jsonb),
       due_date = NULL
 WHERE tags @> '["meeting"]'::jsonb
   AND description LIKE '%Email metadata:%';
