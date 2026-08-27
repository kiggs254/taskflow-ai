import { google } from 'googleapis';
import { query } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';

/**
 * Write a month's KPI report into a Google Sheet, one tab per month.
 *
 * Reuses the Gmail OAuth credentials -- same Google account, same client -- so there is
 * no second connect flow. It needs the spreadsheets scope, which is requested alongside
 * the Gmail scopes; an account connected before that scope existed will get a clear
 * "reconnect Gmail" error rather than a confusing 403 from Google.
 */

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const authFor = async (userId) => {
  const row = (
    await query(
      'SELECT access_token, refresh_token, token_expires_at FROM gmail_integrations WHERE user_id = $1',
      [userId]
    )
  ).rows[0];
  if (!row) throw new Error('Google account not connected. Connect Gmail in Settings first.');

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    access_token: decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
    expiry_date: row.token_expires_at ? new Date(row.token_expires_at).getTime() : undefined,
  });
  return client;
};


/**
 * Turn a googleapis error into something actionable.
 *
 * The first version of this asserted the cause was a missing scope, which swallowed
 * Google's own message and sent the reader off to reconnect an account that was already
 * fine. Google distinguishes these cases clearly -- report what it actually said, and
 * only add guidance when the message identifies the cause.
 */
export const explainGoogleError = (e) => {
  const detail =
    e?.response?.data?.error?.message ||
    e?.errors?.[0]?.message ||
    e?.message ||
    'unknown error';
  const status = e?.code ?? e?.response?.status;

  // The API is not switched on for the Cloud project behind these OAuth credentials.
  // Nothing about the account, the sheet or the scopes is wrong -- and reconnecting
  // will not help, which is exactly why the old message was misleading.
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(detail)) {
    const project = /project (\d+)/i.exec(detail)?.[1];
    return new Error(
      'The Google Sheets API is not enabled for the Cloud project behind your OAuth ' +
        'credentials. Enable it here, then retry (no need to reconnect):\n' +
        `https://console.cloud.google.com/apis/library/sheets.googleapis.com${project ? `?project=${project}` : ''}\n\n` +
        `Google said: ${detail}`
    );
  }

  if (/insufficient|scope/i.test(detail)) {
    return new Error(
      `Your Google connection is missing the Sheets scope (${SHEETS_SCOPE}). ` +
        'Disconnect and reconnect Gmail in Settings to grant it.\n\n' +
        `Google said: ${detail}`
    );
  }

  if (status === 404) {
    return new Error(`No spreadsheet with that ID, or this account can't see it.\n\nGoogle said: ${detail}`);
  }

  if (status === 403) {
    return new Error(
      `Google refused the spreadsheet (403). Check the sheet is owned by, or shared ` +
        `with, the Google account connected in Settings.\n\nGoogle said: ${detail}`
    );
  }

  return new Error(`Google Sheets error${status ? ` (${status})` : ''}: ${detail}`);
};

/** The report as a 2-D grid: exactly the layout the review template uses. */
export const toGrid = (report) => {
  const rows = [];
  rows.push([`KPI Report — ${report.month}`]);
  rows.push([`Period`, `${report.period.from} to ${report.period.to}`]);
  if (report.score?.overall != null) {
    rows.push(['Overall score', `${report.score.overall}%`,
      `based on ${report.score.coverage}% of the weighting that could be measured`]);
  }
  rows.push([]);
  rows.push(['Category', 'Weight', 'Score', 'Targets met']);
  for (const c of report.categories) {
    rows.push([
      c.name,
      `${c.weight}%`,
      c.score == null ? 'not scored' : `${c.score}%`,
      c.metricsScored ? `${c.metricsMet} of ${c.metricsScored}` : '—',
    ]);
  }
  rows.push(['Total', '100%', report.score?.overall != null ? `${report.score.overall}%` : 'not scored', '']);
  rows.push([]);

  for (const c of report.categories) {
    rows.push([`${c.name} — ${c.weight}% of KPI score`, c.score == null ? 'not scored' : `score ${c.score}%`]);
    rows.push(['Metric', 'Target', 'Actual', 'Status', 'Source', 'Note']);
    for (const m of c.metrics) {
      rows.push([
        m.metric,
        m.targetLabel ?? m.target?.label ?? 'Tracked',
        // An unproven figure is left blank for a human, never zero-filled.
        m.value === null || m.value === undefined ? '' : String(m.value),
        { met: 'Met', missed: 'Missed', 'no-data': 'No data', 'no-target': '' }[m.status] ?? '',
        m.source,
        m.note || '',
      ]);
    }
    rows.push([]);
  }

  rows.push(['Evidence']);
  rows.push(['Repositories scanned', String(report.evidence.repos)]);
  rows.push(['Commits analysed', String(report.evidence.commits)]);
  rows.push(['Commits not conventional (uncategorised)', String(report.evidence.unconventionalCommits ?? 0)]);
  rows.push(['Fleet data connected', report.evidence.fleetConnected ? 'yes' : 'no']);
  if (report.evidence.fleetError) rows.push(['Fleet error', report.evidence.fleetError]);
  return rows;
};

/** Tab-separated, for pasting straight into a sheet with no API access at all. */
export const toTsv = (report) =>
  toGrid(report)
    .map((r) => r.map((c) => String(c ?? '').replace(/\t/g, ' ')).join('\t'))
    .join('\n');

/**
 * Write the grid to a new tab named after the month. Idempotent: re-running replaces
 * the tab's contents rather than appending a second copy or creating "July (1)".
 */
export const writeMonthTab = async (userId, spreadsheetId, report) => {
  const auth = await authFor(userId);
  const sheets = google.sheets({ version: 'v4', auth });
  const title = report.month;

  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId });
  } catch (e) {
    throw explainGoogleError(e);
  }

  const existing = meta.data.sheets?.find((s) => s.properties?.title === title);
  const values = toGrid(report);
  try {
    if (!existing) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      });
    } else {
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${title}!A1:Z400` });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  } catch (e) {
    // A read can succeed on a sheet the account may not WRITE to, so the write needs
    // the same explanation rather than surfacing a raw googleapis stack.
    throw explainGoogleError(e);
  }

  return { spreadsheetId, tab: title, rows: values.length, created: !existing };
};
