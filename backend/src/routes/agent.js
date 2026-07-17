import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authenticateAgent } from '../middleware/agentAuth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getAgentSettings,
  updateAgentSettings,
  logWork,
  resummariseSessions,
} from '../services/agentService.js';
import { createApiToken, listApiTokens, revokeApiToken } from '../services/apiTokenService.js';

const router = express.Router();

/**
 * Two audiences, two auth schemes, deliberately not sharing a `router.use`:
 *
 *   /policy, /log-work  -> authenticateAgent (API token, scope 'agent')
 *   /settings, /tokens  -> authenticate (normal login session, from the UI)
 *
 * An API token can therefore report work and read its own policy, and nothing else —
 * it can't read tasks, mint more tokens, or change which folders count as work.
 */

// --- machine-facing ---------------------------------------------------------

/**
 * GET /api/agent/policy
 * The hook caches this locally and uses it to decide whether a session is work.
 * That check has to happen on the machine: a personal session must send nothing at
 * all, so the server can't be the one deciding.
 */
router.get('/policy', authenticateAgent, asyncHandler(async (req, res) => {
  const settings = await getAgentSettings(req.user.id);
  res.json({
    enabled: settings.enabled,
    workPaths: settings.work_paths || [],
  });
}));

/**
 * POST /api/agent/log-work
 * Body: { sessionId, cwd, projectDir, gitRemote, commitShas[], changedPaths[],
 *         prompts[], startedAt, endedAt, timezone }
 *
 * Always 200 on a well-formed request: "not a work path" and "GitHub already covers
 * this" are normal outcomes, not errors. The hook can't react to a failure anyway —
 * SessionEnd ignores exit codes.
 */
router.post('/log-work', authenticateAgent, asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const result = await logWork(req.user.id, req.body);
  res.json(result);
}));

/**
 * POST /api/agent/resummarise
 * Body: { day?, sessionId?, force? }
 *
 * Replays stored prompts through the summariser and rebuilds the affected day tasks.
 * For sessions logged while summarisation was silently truncating: their fallback
 * title is cached on the row, so fixing the summariser doesn't retroactively fix them.
 *
 * On the agent token rather than a login session: it only ever touches rows the agent
 * itself wrote, and it grants no capability log-work doesn't already have (that calls
 * the same summariser). Defaults to only re-doing rows with no items — a re-run of a
 * good summary just costs money.
 */
router.post('/resummarise', authenticateAgent, asyncHandler(async (req, res) => {
  const { day, sessionId, force } = req.body || {};
  res.json(await resummariseSessions(req.user.id, { day, sessionId, force: Boolean(force) }));
}));

// --- UI-facing --------------------------------------------------------------

router.get('/settings', authenticate, asyncHandler(async (req, res) => {
  const settings = await getAgentSettings(req.user.id);
  res.json({ enabled: settings.enabled, workPaths: settings.work_paths || [] });
}));

router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const settings = await updateAgentSettings(req.user.id, req.body);
  res.json({ enabled: settings.enabled, workPaths: settings.work_paths || [] });
}));

router.get('/tokens', authenticate, asyncHandler(async (req, res) => {
  res.json({ tokens: await listApiTokens(req.user.id) });
}));

/**
 * POST /api/agent/tokens -> { token } exactly once; it is stored hashed and can
 * never be read back.
 */
router.post('/tokens', authenticate, asyncHandler(async (req, res) => {
  const created = await createApiToken(req.user.id, req.body?.name || 'CLI');
  res.json(created);
}));

router.delete('/tokens/:id', authenticate, asyncHandler(async (req, res) => {
  const revoked = await revokeApiToken(req.user.id, Number(req.params.id));
  if (!revoked) return res.status(404).json({ error: 'Token not found' });
  res.json({ success: true });
}));

export default router;
