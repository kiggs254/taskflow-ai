import { query } from '../config/database.js';
import { DEFAULT_TIMEZONE, startOfLocalDayMs, localDateString, isValidTimezone } from '../utils/time.js';

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
export const getCompletedToday = async (
  userId,
  { timezone = DEFAULT_TIMEZONE, atMs = Date.now(), since = null } = {}
) => {
  const tz = resolveTz(timezone);
  const midnight = startOfLocalDayMs(tz, atMs);

  // The window ends NOW, not at local midnight.
  //
  // Midnight is in the future at 16:30, so [midnight, midnight+1d) and
  // [16:30, tomorrow midnight) overlap by 7.5 hours. Nothing duplicates today only
  // because a task can't be completed in the future -- a true statement that the
  // correctness of the partition should not depend on. Ending at the send instant
  // makes consecutive reports provably disjoint.
  const windowEnd = atMs;

  // The window starts where the last report stopped, not at midnight.
  //
  // Anchored to midnight, work finished after the 16:30 send belonged to a day whose
  // report had already gone out, and tomorrow's report only looks at tomorrow. So
  // evening work fell into a 7.5-hour hole and appeared in no report, ever -- it
  // wasn't deferred to the next day, it was dropped. Anchoring to the previous send
  // makes consecutive reports an exact partition of time: every completed task lands
  // in exactly one report, and after-hours work rolls into the next one.
  //
  // Clamped to 7 days for the same reason the Slack scanner clamps its window: an
  // account that has never sent (or hasn't in months, because require_commits kept it
  // quiet) would otherwise make its first report dump the entire backlog.
  const CLAMP_MS = 7 * 24 * 60 * 60 * 1000;
  const windowStart = since ? Math.max(Number(since), atMs - CLAMP_MS) : midnight;

  // Candidates: completed in-window, OR carrying a subtask completed in-window.
  // The subtask arm is why this can't just be `status='done' AND completed_at ...`.
  const result = await query(
    `SELECT t.id, t.title, t.workspace, t.energy, t.status, t.tags, t.subtasks,
            t.completed_at AS "completedAt", t.estimated_time AS "estimatedTime",
            (pc.task_id IS NOT NULL) AS "fromCommits",
            (ag.task_id IS NOT NULL) AS "fromAgent"
     FROM tasks t
     LEFT JOIN LATERAL (
       SELECT DISTINCT task_id FROM processed_commits
       WHERE task_id = t.id AND user_id = $1 LIMIT 1
     ) pc ON true
     LEFT JOIN LATERAL (
       SELECT DISTINCT task_id FROM agent_sessions
       WHERE task_id = t.id AND user_id = $1 LIMIT 1
     ) ag ON true
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
    [userId, windowStart, windowEnd]
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
        row.status === 'done' && row.completedAt >= windowStart && row.completedAt < windowEnd;
      if (!completedInWindow) continue;
      items.push({ ...row, subtasks: [] });
    }
  }

  // Decided by the ledger joins, not by sniffing the 'github' tag -- a user can edit
  // a tag off a task, and that must not change the gate.
  const commitItems = items.filter((i) => i.fromCommits);
  const agentItems = items.filter((i) => i.fromAgent);

  return {
    date: localDateString(tz, atMs),
    timezone: tz,
    windowStart,
    windowEnd,
    // Kept: the preview reads these. They are the report window, which is no longer
    // the calendar day -- it starts at the previous send.
    dayStart: windowStart,
    dayEnd: windowEnd,
    items,
    // "Did I actually do tracked work today", not "did I commit".
    //
    // This gates the 16:30 report. Counting only commits meant a day of purely
    // agent-logged work -- WordPress, ops, anything not in a tracked repo -- sent no
    // report at all, i.e. the report went silent on exactly the days the agent
    // logging exists to capture.
    commitDerived: commitItems.length > 0 || agentItems.length > 0,
    commitCount: commitItems.length,
    agentCount: agentItems.length,
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
export const claimReportDay = async (userId, dateStr, atMs = Date.now()) => {
  const result = await query(
    `UPDATE user_report_settings
     SET last_sent_on = $2, last_sent_at = $3
     WHERE user_id = $1 AND last_sent_on IS DISTINCT FROM $2
     RETURNING user_id`,
    [userId, dateStr, atMs]
  );
  return result.rows.length > 0;
};

/**
 * Undo a claim when every channel failed, so the next tick can retry.
 *
 * last_sent_at is restored to what it was, not cleared: it's the next report's window
 * start, and a failed send must not advance it. Cleared, the window would silently
 * skip forward over work nobody ever received; left at the claim time, the same.
 */
export const releaseReportDay = async (userId, dateStr, previousSentAt = null) => {
  await query(
    `UPDATE user_report_settings SET last_sent_on = NULL, last_sent_at = $3
     WHERE user_id = $1 AND last_sent_on = $2`,
    [userId, dateStr, previousSentAt]
  );
};
