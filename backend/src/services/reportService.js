import crypto from 'crypto';
import { query } from '../config/database.js';
import { DEFAULT_TIMEZONE, startOfLocalDayMs, localDateString, isValidTimezone } from '../utils/time.js';
import { callAI } from './ai/callAI.js';
import { truncateAtWord } from '../utils/text.js';

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
         (
           t.status = 'done' AND t.completed_at >= $2 AND t.completed_at < $3
           -- ...but only for tasks that carry NO per-subtask timestamps. Integration
           -- day-tasks (GitHub, agent) accrete: completed_at advances to the latest
           -- commit/session all day, so a task reported at 16:30 re-qualifies the next
           -- day the moment one more commit lands -- and drags every already-reported
           -- subtask back in with it. Those tasks qualify below, on their immutable
           -- per-subtask timestamps, which partition time cleanly.
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(t.subtasks) = 'array' THEN t.subtasks ELSE '[]'::jsonb END
             ) st2
             WHERE (st2->>'completedAt') ~ '^[0-9]+$'
           )
         )
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

  // A subtask's completedAt as a number, or null if it doesn't carry one.
  const numAt = (s) => {
    const v = s?.completedAt;
    if (typeof v === 'number') return v;
    return /^[0-9]+$/.test(String(v)) ? Number(v) : null;
  };

  const items = [];
  for (const row of result.rows) {
    const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];
    const timestamped = subtasks.filter((s) => s.completed && numAt(s) !== null);

    if (timestamped.length > 0) {
      // Show ONLY the subtasks completed in this window, not all of them.
      //
      // This is the fix for the same commits appearing in consecutive reports. The
      // parent task is a mutable daily aggregate whose completed_at keeps advancing,
      // but each subtask's completedAt is the immutable commit/session time, and the
      // windows partition time -- so every subtask lands in exactly one report.
      // Showing all subtasks re-sent yesterday's work every time a new commit extended
      // the task into today.
      const inWindow = timestamped.filter((s) => {
        const t = numAt(s);
        return t >= windowStart && t < windowEnd;
      });
      if (inWindow.length === 0) continue; // its in-window work was already reported
      items.push({ ...row, subtasks: inWindow });
    } else if (subtasks.length > 0) {
      // Subtasks without timestamps: a hand-made task. Fall back to task-level
      // completion and show all of them, preserving the manual-task reading (a
      // half-finished task shows as progress, not a shorter finished one).
      const completedInWindow =
        row.status === 'done' && row.completedAt >= windowStart && row.completedAt < windowEnd;
      if (!completedInWindow) continue;
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
 * Split a "project — outcome" task title. Titles are built this way upstream (GitHub
 * and agent summaries both), so the project is the bold anchor and the outcome the
 * prose.
 */
export const splitProjectTitle = (title) => {
  const raw = String(title ?? '').trim();
  const i = raw.indexOf(' — ');
  if (i === -1) return { project: raw, outcome: '' };
  return { project: raw.slice(0, i).trim(), outcome: raw.slice(i + 3).trim() };
};

const NARRATIVE_SCHEMA = {
  name: 'day_narrative',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['narrative'],
    properties: {
      narrative: {
        type: 'string',
        description:
          'One or two short past-tense sentences telling the story of what was done ' +
          'in this project, in plain language a non-technical teammate understands. ' +
          'No bullet points, no commit prefixes like feat()/fix(), no file names.',
      },
    },
  },
};

// Same narrative for the same commits, so opening the preview repeatedly and then the
// real send don't each re-bill a smart-tier call. Content-addressed: identical
// subtask sets hash the same. Bounded so it can't grow without limit in a long-lived
// process.
const narrativeCache = new Map();
const NARRATIVE_CACHE_MAX = 500;

const narrateItem = async (userId, item) => {
  const { project, outcome } = splitProjectTitle(item.title);
  const lines = (item.subtasks || [])
    .filter((s) => s.completed && s.title)
    .map((s) => String(s.title).trim());

  // Fallback is the existing AI day-summary's outcome (or the whole title). Never
  // invent a story; if there's nothing to summarise or the model is down, show what
  // we already have.
  const fallback = outcome || String(item.title ?? '').trim();
  if (!lines.length) return fallback;

  const key = crypto
    .createHash('sha256')
    .update(`${project}\n${lines.join('\n')}`)
    .digest('hex');
  if (narrativeCache.has(key)) return narrativeCache.get(key);

  let narrative = fallback;
  try {
    const { content } = await callAI({
      taskKind: 'report_narrative',
      tier: 'smart',
      userId,
      temperature: 0.3,
      maxTokens: 400,
      schema: NARRATIVE_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You write one short daily-standup paragraph for a single project. Given ' +
            'the commits made in one work session, tell the story of what was ' +
            'accomplished and why it matters, in one or two plain past-tense sentences ' +
            'a teammate who does not read code can follow. Group related commits into ' +
            'the same thread of work. Do not list the commits, do not keep prefixes ' +
            'like feat()/fix()/chore(), no bullet points, no markdown, no file names. ' +
            'Keep it short. Return json.',
        },
        {
          role: 'user',
          content: `Project: ${project}\n\nCommits in this session:\n${lines
            .map((l) => `- ${l}`)
            .join('\n')}`,
        },
      ],
    });
    const parsed = JSON.parse(content);
    const n = typeof parsed?.narrative === 'string' ? parsed.narrative.trim() : '';
    if (n) narrative = truncateAtWord(n, 400);
  } catch (error) {
    console.error(`Report narrative failed for "${project}", using fallback:`, error.message);
  }

  if (narrativeCache.size >= NARRATIVE_CACHE_MAX) {
    narrativeCache.delete(narrativeCache.keys().next().value);
  }
  narrativeCache.set(key, narrative);
  return narrative;
};

/**
 * Attach a `project` and an AI-written `narrative` to every report item, in place.
 *
 * Separate from getCompletedToday, which stays pure SQL: this is the one place AI
 * touches the report, and both the 16:30 send and the Settings preview call it so the
 * preview shows exactly what will be sent. Items are narrated concurrently, and a
 * failure on one never rejects the batch -- narrateItem swallows its own errors.
 */
export const attachNarratives = async (report, userId) => {
  await Promise.all(
    (report.items || []).map(async (item) => {
      const { project } = splitProjectTitle(item.title);
      item.project = project;
      item.narrative = await narrateItem(userId, item);
    })
  );
  return report;
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
