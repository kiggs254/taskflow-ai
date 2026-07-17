import { query } from '../config/database.js';
import { DEFAULT_TIMEZONE, startOfLocalDayMs, endOfLocalDayMs, localDateString, isValidTimezone } from '../utils/time.js';

/**
 * "What did I finish today", server-side.
 *
 * This logic used to live only in App.tsx inside the manual Daily Reset flow, which
 * meant the report existed solely as a side effect of a UI action. Moving it here
 * gives the cron job and the in-app view a single implementation, so they can't
 * disagree about what "completed today" means.
 *
 * The two subtlety-preserving rules ported verbatim from the frontend:
 *   - a task counts if ANY of its subtasks was completed today, even if the task
 *     itself is not done;
 *   - for a partially-complete task, ALL subtasks are shown (done and undone), so
 *     the report reads as progress rather than a truncated list.
 */

const resolveTz = (tz) => (isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE);

export const getReportSettings = async (userId) => {
  const result = await query('SELECT * FROM user_report_settings WHERE user_id = $1', [userId]);
  if (result.rows[0]) return result.rows[0];

  // Lazily create defaults so a user who never opened Settings still gets a report.
  const created = await query(
    `INSERT INTO user_report_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId]
  );
  return created.rows[0] ?? (await query('SELECT * FROM user_report_settings WHERE user_id = $1', [userId])).rows[0];
};

export const updateReportSettings = async (userId, patch) => {
  await getReportSettings(userId); // ensure the row exists

  const allowed = {
    timezone: (v) => (isValidTimezone(v) ? v : null),
    report_time: (v) => (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v) ? v : null),
    email_enabled: (v) => (typeof v === 'boolean' ? v : null),
    slack_enabled: (v) => (typeof v === 'boolean' ? v : null),
    slack_channel: (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/^#/, '') : null),
    require_commits: (v) => (typeof v === 'boolean' ? v : null),
  };

  const sets = [];
  const params = [userId];
  for (const [col, coerce] of Object.entries(allowed)) {
    if (!(col in patch)) continue;
    const value = coerce(patch[col]);
    if (value === null) continue;
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }

  if (sets.length) {
    await query(`UPDATE user_report_settings SET ${sets.join(', ')} WHERE user_id = $1`, params);
  }
  return getReportSettings(userId);
};

/**
 * Build the report payload for a user's local day.
 */
export const getCompletedToday = async (userId, { timezone = DEFAULT_TIMEZONE, atMs = Date.now() } = {}) => {
  const tz = resolveTz(timezone);
  const dayStart = startOfLocalDayMs(tz, atMs);
  const dayEnd = endOfLocalDayMs(tz, atMs);

  // Candidates: completed in-window, OR carrying a subtask completed in-window.
  // The subtask arm is why this can't just be `status='done' AND completed_at ...`.
  const result = await query(
    `SELECT t.id, t.title, t.workspace, t.energy, t.status, t.tags, t.subtasks,
            t.completed_at AS "completedAt", t.estimated_time AS "estimatedTime",
            (pc.task_id IS NOT NULL) AS "fromCommits"
     FROM tasks t
     LEFT JOIN LATERAL (
       SELECT DISTINCT task_id FROM processed_commits
       WHERE task_id = t.id AND user_id = $1 LIMIT 1
     ) pc ON true
     WHERE t.user_id = $1
       AND (
         (t.status = 'done' AND t.completed_at >= $2 AND t.completed_at < $3)
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(t.subtasks) = 'array' THEN t.subtasks ELSE '[]'::jsonb END
           ) st
           WHERE (st->>'completed')::boolean IS TRUE
             AND (st->>'completedAt') ~ '^[0-9]+$'
             AND (st->>'completedAt')::bigint >= $2
             AND (st->>'completedAt')::bigint < $3
         )
       )
     ORDER BY t.completed_at ASC NULLS LAST`,
    [userId, dayStart, dayEnd]
  );

  const items = [];
  for (const row of result.rows) {
    const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];

    if (subtasks.length > 0) {
      const done = subtasks.filter((s) => s.completed);
      if (done.length === 0) continue; // nothing actually progressed
      // Show every subtask, not just the completed ones: a half-finished task should
      // read as progress, not as a shorter finished task.
      items.push({ ...row, subtasks });
    } else {
      const completedInWindow =
        row.status === 'done' && row.completedAt >= dayStart && row.completedAt < dayEnd;
      if (!completedInWindow) continue;
      items.push({ ...row, subtasks: [] });
    }
  }

  // Commit-derivation is decided by the ledger join, not by sniffing the 'github'
  // tag -- a user can edit a tag off a task, and that must not change the gate.
  const commitItems = items.filter((i) => i.fromCommits);

  return {
    date: localDateString(tz, atMs),
    timezone: tz,
    dayStart,
    dayEnd,
    items,
    commitDerived: commitItems.length > 0,
    commitCount: commitItems.length,
    counts: {
      tasks: items.length,
      subtasks: items.reduce((n, i) => n + i.subtasks.filter((s) => s.completed).length, 0),
    },
  };
};

/**
 * Atomically claim today's send slot.
 *
 * Returns false if someone already claimed it. Coolify redeploys, container
 * restarts and any future second instance all make the 16:30 tick fire more than
 * once; a duplicate report in a team channel is worse than a missed one, so this is
 * deliberately at-most-once: claim first, then send.
 */
export const claimReportDay = async (userId, dateStr) => {
  const result = await query(
    `UPDATE user_report_settings
     SET last_sent_on = $2
     WHERE user_id = $1 AND last_sent_on IS DISTINCT FROM $2
     RETURNING user_id`,
    [userId, dateStr]
  );
  return result.rows.length > 0;
};

/** Undo a claim when every channel failed, so the next tick can retry. */
export const releaseReportDay = async (userId, dateStr) => {
  await query(
    'UPDATE user_report_settings SET last_sent_on = NULL WHERE user_id = $1 AND last_sent_on = $2',
    [userId, dateStr]
  );
};
