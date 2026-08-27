import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { query } from '../config/database.js';
import { getMonthlyKpi } from '../services/kpiService.js';
import { toTsv, writeMonthTab } from '../services/kpiSheet.js';

const router = express.Router();
router.use(authenticate);

const getSettings = async (userId) => {
  const r = await query('SELECT * FROM kpi_settings WHERE user_id = $1', [userId]);
  if (r.rows[0]) return r.rows[0];
  const created = await query(
    'INSERT INTO kpi_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING *',
    [userId]
  );
  return created.rows[0] ?? (await query('SELECT * FROM kpi_settings WHERE user_id = $1', [userId])).rows[0];
};

const toClient = (s) => ({
  fleetBaseUrl: s.fleet_base_url,
  // Never echo the key back; only whether one is stored.
  fleetApiKeySet: Boolean(s.fleet_api_key),
  workInstanceIds: s.work_instance_ids || [],
  sheetId: s.sheet_id,
});

router.get('/settings', asyncHandler(async (req, res) => {
  res.json(toClient(await getSettings(req.user.id)));
}));

router.put('/settings', asyncHandler(async (req, res) => {
  await getSettings(req.user.id);
  const { fleetBaseUrl, fleetApiKey, workInstanceIds, sheetId } = req.body || {};
  const sets = [];
  const params = [req.user.id];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (typeof fleetBaseUrl === 'string') add('fleet_base_url', fleetBaseUrl.trim().replace(/\/$/, '') || null);
  // Only overwrite the key when a new one is actually supplied, so saving other
  // settings from a form that never received the key can't blank it.
  if (typeof fleetApiKey === 'string' && fleetApiKey.trim()) add('fleet_api_key', fleetApiKey.trim());
  if (Array.isArray(workInstanceIds)) {
    add('work_instance_ids', JSON.stringify(workInstanceIds.filter((s) => typeof s === 'string').slice(0, 200)));
  }
  if (typeof sheetId === 'string') add('sheet_id', sheetId.trim() || null);

  if (sets.length) await query(`UPDATE kpi_settings SET ${sets.join(', ')} WHERE user_id = $1`, params);
  res.json(toClient(await getSettings(req.user.id)));
}));

/** The fleet, so the UI can offer "which of these are work?". */
router.get('/instances', asyncHandler(async (req, res) => {
  const s = await getSettings(req.user.id);
  if (!s.fleet_base_url || !s.fleet_api_key) {
    return res.status(400).json({ error: 'Fleet manager not configured' });
  }
  const r = await fetch(`${s.fleet_base_url}/api/kpi?list=instances`, {
    headers: { Authorization: `Bearer ${s.fleet_api_key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return res.status(502).json({ error: `Fleet manager returned ${r.status}` });
  const data = await r.json();
  res.json({ instances: data.instances || [], selected: s.work_instance_ids || [] });
}));

/**
 * GET /api/kpi/monthly?month=2026-07&format=json|tsv
 * TSV exists so a report can be pasted straight into a sheet with no Google auth at
 * all -- useful the first time, and a fallback whenever the API path is unavailable.
 */
router.get('/monthly', asyncHandler(async (req, res) => {
  const month = String(req.query.month || '').trim();
  const report = await getMonthlyKpi(req.user.id, { month, timezone: req.query.tz });
  if (req.query.format === 'tsv') {
    res.type('text/tab-separated-values').send(toTsv(report));
    return;
  }
  res.json(report);
}));

/** POST /api/kpi/export-sheet { month, spreadsheetId? } -> one tab per month. */
router.post('/export-sheet', asyncHandler(async (req, res) => {
  const s = await getSettings(req.user.id);
  const spreadsheetId = (req.body?.spreadsheetId || s.sheet_id || '').trim();
  if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId is required' });

  const report = await getMonthlyKpi(req.user.id, { month: String(req.body?.month || '').trim() });
  const out = await writeMonthTab(req.user.id, spreadsheetId, report);

  if (spreadsheetId !== s.sheet_id) {
    await query('UPDATE kpi_settings SET sheet_id = $2 WHERE user_id = $1', [req.user.id, spreadsheetId]);
  }
  res.json({ ...out, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` });
}));

export default router;
