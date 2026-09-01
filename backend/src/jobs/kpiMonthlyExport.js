import cron from 'node-cron';
import { query } from '../config/database.js';
import { getMonthlyKpi } from '../services/kpiService.js';
import { writeMonthTab } from '../services/kpiSheet.js';
import { DEFAULT_TIMEZONE, localDateString, isValidTimezone } from '../utils/time.js';

/**
 * Write last month's KPI report to Google Sheets on the morning of the 1st.
 *
 * Checked hourly rather than scheduled as a single monthly cron. A one-shot cron is
 * skipped outright if the process happens to be restarting at that minute -- exactly how
 * a daily report went missing -- so this fires on the first tick at or after 06:00 on
 * the 1st, and if the whole of the 1st is missed it still catches up later in the month
 * rather than losing it. The claim below is what stops a second write, not the narrowness
 * of the schedule.
 */
const EXPORT_FROM_HOUR = 6;

/** The previous calendar month, in the user's timezone, as YYYY-MM. */
export const previousMonth = (tz = DEFAULT_TIMEZONE, atMs = Date.now()) => {
  const today = localDateString(tz, atMs); // YYYY-MM-DD in their local time
  const [y, m] = today.split('-').map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

/**
 * Claim the month before exporting, so a restart mid-run can't redo the work.
 * Returns false when this month's export has already been claimed.
 */
const claimMonth = async (userId, month) => {
  const r = await query(
    `UPDATE kpi_settings SET last_exported_month = $2
      WHERE user_id = $1 AND last_exported_month IS DISTINCT FROM $2
      RETURNING user_id`,
    [userId, month]
  );
  return r.rows.length > 0;
};

const releaseMonth = async (userId, month, previous) => {
  await query(
    'UPDATE kpi_settings SET last_exported_month = $3 WHERE user_id = $1 AND last_exported_month = $2',
    [userId, month, previous]
  );
};

export const runMonthlyExport = async ({ atMs = Date.now() } = {}) => {
  const rows = (
    await query(
      `SELECT k.user_id, k.sheet_id, k.last_exported_month, r.timezone
         FROM kpi_settings k
         LEFT JOIN user_report_settings r ON r.user_id = k.user_id
        WHERE k.sheet_id IS NOT NULL AND k.sheet_id <> ''`
    )
  ).rows;

  const results = [];
  for (const row of rows) {
    const tz = isValidTimezone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE;
    const month = previousMonth(tz, atMs);

    // Already done (or being done) for this month.
    if (row.last_exported_month === month) continue;

    // Hold until the morning of the 1st. Past the 1st this is already true, so a month
    // missed entirely (container down all day) is still exported rather than lost.
    const local = localDateString(tz, atMs);         // YYYY-MM-DD
    const dayOfMonth = Number(local.slice(8, 10));
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(atMs)
    );
    if (dayOfMonth === 1 && hour < EXPORT_FROM_HOUR) continue;

    const previous = row.last_exported_month;
    if (!(await claimMonth(row.user_id, month))) continue;

    try {
      // Built fresh: this is the month's first look at the completed period, and the
      // stored snapshot (if any) was generated mid-month from partial data.
      const report = await getMonthlyKpi(row.user_id, { month, timezone: tz, refresh: true });
      const out = await writeMonthTab(row.user_id, row.sheet_id, report);
      console.log(`KPI export: user ${row.user_id} -> tab ${out.tab} (${out.rows} rows)`);
      results.push({ userId: row.user_id, month, ok: true });
    } catch (error) {
      // Put the claim back so the next hourly tick retries -- a Google outage or an
      // expired token must not cost the month's export entirely.
      await releaseMonth(row.user_id, month, previous);
      console.error(`KPI export failed for user ${row.user_id} (${month}):`, error.message);
      results.push({ userId: row.user_id, month, ok: false, error: error.message });
    }
  }
  return results;
};

export const startKpiMonthlyExport = () => {
  cron.schedule('7 * * * *', async () => {
    try {
      await runMonthlyExport();
    } catch (error) {
      console.error('KPI monthly export job error:', error.message);
    }
  });
  console.log('KPI monthly export job scheduled (hourly; exports last month once it ends)');
};
