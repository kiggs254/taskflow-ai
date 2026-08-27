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

/** The report as a 2-D grid: exactly the layout the review template uses. */
export const toGrid = (report) => {
  const rows = [];
  rows.push([`KPI Report — ${report.month}`]);
  rows.push([`Period`, `${report.period.from} to ${report.period.to}`]);
  rows.push([]);
  rows.push(['Category', 'Weight']);
  for (const c of report.categories) rows.push([c.name, `${c.weight}%`]);
  rows.push(['Total', '100%']);
  rows.push([]);

  for (const c of report.categories) {
    rows.push([`${c.name} — ${c.weight}% of KPI score`]);
    rows.push(['Metric', 'Target', 'Actual', 'Source', 'Note']);
    for (const m of c.metrics) {
      rows.push([
        m.metric,
        m.target,
        // An unproven figure is left blank for a human, never zero-filled.
        m.value === null || m.value === undefined ? '' : String(m.value),
        m.source === 'manual' ? 'NEEDS INPUT' : m.source,
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
    if (e?.code === 403 || e?.response?.status === 403) {
      throw new Error(
        'Google refused the spreadsheet. Reconnect Gmail in Settings to grant the ' +
          `Sheets scope (${SHEETS_SCOPE}), and check the sheet belongs to that account.`
      );
    }
    throw e;
  }

  const existing = meta.data.sheets?.find((s) => s.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  } else {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${title}!A1:Z400` });
  }

  const values = toGrid(report);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return { spreadsheetId, tab: title, rows: values.length, created: !existing };
};
