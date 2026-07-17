import { query } from '../config/database.js';
import { DEFAULT_TIMEZONE, isValidTimezone, startOfLocalDayMs } from '../utils/time.js';

/**
 * Server-side analytics aggregation.
 *
 * AnalyticsScreen previously derived everything from the full in-memory task array,
 * which is a large part of why the client held every task ever created and why the
 * 15s poll was expensive. Streaks and time-of-day bucketing are also gaps-and-islands
 * problems that SQL does in one pass and JS does badly.
 *
 * Everything is scoped to the user's local day via `AT TIME ZONE`, so "Monday" means
 * their Monday.
 */

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

const tsExpr = (col) => `to_timestamp(${col} / 1000.0)`;

export const getAnalyticsSummary = async (userId, { range = '30d', timezone = DEFAULT_TIMEZONE } = {}) => {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const days = RANGES[range] ?? 30;
  const now = Date.now();
  const rangeStart = startOfLocalDayMs(tz, now) - (days - 1) * 86_400_000;

  const p = [userId, rangeStart, tz];

  // --- headline ---------------------------------------------------------------
  const headline = (
    await query(
      `SELECT
         count(*) FILTER (WHERE status = 'done' AND completed_at >= $2)::int AS completed,
         count(*) FILTER (WHERE status <> 'done')::int AS open,
         count(*) FILTER (WHERE created_at >= $2)::int AS created,
         count(*) FILTER (WHERE status = 'done' AND completed_at >= $2 AND due_date IS NOT NULL
                            AND completed_at <= due_date)::int AS on_time,
         count(*) FILTER (WHERE status = 'done' AND completed_at >= $2 AND due_date IS NOT NULL)::int AS with_due,
         count(DISTINCT ${tsExpr('completed_at')} AT TIME ZONE $3)
           FILTER (WHERE status = 'done' AND completed_at >= $2)::int AS active_days,
         COALESCE(percentile_cont(0.5) WITHIN GROUP (
           ORDER BY (completed_at - created_at)
         ) FILTER (WHERE status = 'done' AND completed_at >= $2 AND completed_at > created_at), 0) AS median_cycle_ms,
         COALESCE(sum(estimated_time) FILTER (WHERE status = 'done' AND completed_at >= $2), 0)::int AS est_minutes
       FROM tasks WHERE user_id = $1`,
      p
    )
  ).rows[0];

  // --- per-day series (drives the bar chart + streaks) ------------------------
  const perDay = (
    await query(
      `SELECT to_char(${tsExpr('completed_at')} AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
              count(*)::int AS n
       FROM tasks
       WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY day ORDER BY day`,
      p
    )
  ).rows;

  // --- breakdowns -------------------------------------------------------------
  const byWorkspace = (
    await query(
      `SELECT COALESCE(workspace, 'unknown') AS key, count(*)::int AS n
       FROM tasks WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY key ORDER BY n DESC`,
      p
    )
  ).rows;

  const byEnergy = (
    await query(
      `SELECT COALESCE(energy, 'unknown') AS key, count(*)::int AS n
       FROM tasks WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY key ORDER BY n DESC`,
      p
    )
  ).rows;

  const byTag = (
    await query(
      `SELECT tag AS key, count(*)::int AS n
       FROM tasks, LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END
       ) AS tag
       WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY tag ORDER BY n DESC LIMIT 15`,
      p
    )
  ).rows;

  // --- day-of-week x hour heatmap --------------------------------------------
  const heatmap = (
    await query(
      `SELECT EXTRACT(dow FROM ${tsExpr('completed_at')} AT TIME ZONE $3)::int AS dow,
              EXTRACT(hour FROM ${tsExpr('completed_at')} AT TIME ZONE $3)::int AS hour,
              count(*)::int AS n
       FROM tasks
       WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY dow, hour`,
      p
    )
  ).rows;

  // --- commit correlation -----------------------------------------------------
  const commitsPerDay = (
    await query(
      `SELECT to_char(${tsExpr('committed_at')} AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
              count(*)::int AS commits
       FROM processed_commits
       WHERE user_id = $1 AND committed_at >= $2
       GROUP BY day ORDER BY day`,
      p
    )
  ).rows;

  // --- source attribution ------------------------------------------------------
  // Answers "is Gmail scanning producing tasks I actually do, or noise I reject?" --
  // a question the product could not previously answer about itself.
  const draftOutcomes = (
    await query(
      `SELECT source,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM draft_tasks
       WHERE user_id = $1
       GROUP BY source`,
      [userId]
    )
  ).rows;

  // --- aging -------------------------------------------------------------------
  const aging = (
    await query(
      `SELECT count(*) FILTER (WHERE created_at < $2)::int AS older_than_range,
              COALESCE(max($2 - created_at), 0)::bigint AS oldest_age_ms
       FROM tasks WHERE user_id = $1 AND status <> 'done'`,
      [userId, now - 30 * 86_400_000]
    )
  ).rows[0];

  // --- self-referential percentile ---------------------------------------------
  // Replaces a hardcoded "You're in the top 10% of users this week!". Comparing the
  // user against their own trailing history is honest, meaningful at n=1 user, and
  // needs no cross-user data.
  const trailing = (
    await query(
      `SELECT to_char(${tsExpr('completed_at')} AT TIME ZONE $3, 'IYYY-IW') AS week,
              count(*)::int AS n
       FROM tasks
       WHERE user_id = $1 AND status = 'done' AND completed_at >= $2
       GROUP BY week ORDER BY week`,
      [userId, now - 90 * 86_400_000, tz]
    )
  ).rows;

  const thisWeek = trailing.length ? trailing[trailing.length - 1].n : 0;
  const priorWeeks = trailing.slice(0, -1).map((r) => r.n);
  const betterThan = priorWeeks.filter((n) => thisWeek > n).length;
  const selfPercentile = priorWeeks.length
    ? Math.round((betterThan / priorWeeks.length) * 100)
    : null;

  const completed = headline.completed;
  const totalOpen = headline.open;

  return {
    range,
    timezone: tz,
    rangeStart,
    headline: {
      completed,
      open: totalOpen,
      created: headline.created,
      completionRate: completed + totalOpen > 0 ? Math.round((completed / (completed + totalOpen)) * 100) : 0,
      activeDays: headline.active_days,
      medianCycleHours: headline.median_cycle_ms ? Math.round(Number(headline.median_cycle_ms) / 3_600_000) : 0,
      backlogDelta: headline.created - completed,
      // Named honestly: this sums estimatedTime, entered *before* the work. It is not
      // tracked time and never was.
      estimatedFocusHours: Math.round((headline.est_minutes / 60) * 10) / 10,
      dueDateReliability: headline.with_due > 0 ? Math.round((headline.on_time / headline.with_due) * 100) : null,
    },
    perDay,
    byWorkspace,
    byEnergy,
    byTag,
    heatmap,
    commitsPerDay,
    draftOutcomes,
    aging: {
      openOlderThan30d: aging.older_than_range,
    },
    selfComparison: {
      thisWeek,
      weeksCompared: priorWeeks.length,
      percentile: selfPercentile,
      best: priorWeeks.length > 0 && thisWeek > Math.max(...priorWeeks),
    },
  };
};

/** Current and longest streak of days with >= 1 completion, in the user's zone. */
export const getStreaks = async (userId, timezone = DEFAULT_TIMEZONE) => {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const rows = (
    await query(
      `SELECT DISTINCT to_char(${tsExpr('completed_at')} AT TIME ZONE $2, 'YYYY-MM-DD') AS day
       FROM tasks
       WHERE user_id = $1 AND status = 'done' AND completed_at IS NOT NULL
       ORDER BY day DESC`,
      [userId, tz]
    )
  ).rows.map((r) => r.day);

  if (!rows.length) return { current: 0, longest: 0 };

  const dayMs = 86_400_000;
  const toUtc = (d) => Date.parse(`${d}T00:00:00Z`);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < rows.length; i++) {
    if (toUtc(rows[i - 1]) - toUtc(rows[i]) === dayMs) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak counts only if it reaches today or yesterday.
  const todayUtc = toUtc(new Date(startOfLocalDayMs(tz)).toISOString().slice(0, 10));
  let current = 0;
  if (toUtc(rows[0]) === todayUtc || toUtc(rows[0]) === todayUtc - dayMs) {
    current = 1;
    for (let i = 1; i < rows.length; i++) {
      if (toUtc(rows[i - 1]) - toUtc(rows[i]) === dayMs) current++;
      else break;
    }
  }

  return { current, longest };
};
