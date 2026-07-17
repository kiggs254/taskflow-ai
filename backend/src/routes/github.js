import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyState } from '../utils/oauthState.js';
import { getAuthUrl, isGithubConfigured } from '../services/githubAuth.js';
import {
  handleInstallCallback,
  listRepos,
  setSelectedRepos,
  scanCommits,
  getGithubStatus,
  updateGithubSettings,
  disconnectGithub,
} from '../services/githubService.js';
import { config } from '../config/env.js';

const router = express.Router();

/**
 * POST /api/github/connect -> { authUrl }
 */
router.post('/connect', authenticate, asyncHandler(async (req, res) => {
  if (!isGithubConfigured()) {
    return res.status(503).json({
      error: 'GitHub is not configured on the server. Set GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY.',
    });
  }
  res.json({ authUrl: getAuthUrl(req.user.id) });
}));

/**
 * GET /api/github/callback
 *
 * Deliberately NOT wrapped in asyncHandler and NOT authenticated: GitHub calls this
 * directly, and every exit path must be a redirect back to the app rather than a JSON
 * error. Same reasoning as the Gmail callback.
 */
router.get('/callback', async (req, res) => {
  const frontend = config.frontend.url;
  try {
    const { state, installation_id: installationId } = req.query;

    // The user id comes from the signed state, never from a query param. Previously
    // integrations passed the bare user id here, which let anyone bind their own
    // account to someone else's.
    const userId = verifyState(state, 'github');

    if (!installationId) throw new Error('Missing installation_id');

    await handleInstallCallback(userId, Number(installationId));
    return res.redirect(`${frontend}/settings?github=connected`);
  } catch (error) {
    console.error('GitHub callback error:', error.message);
    return res.redirect(`${frontend}/settings?github=error&message=${encodeURIComponent(error.message)}`);
  }
});

router.get('/status', authenticate, asyncHandler(async (req, res) => {
  res.json(await getGithubStatus(req.user.id));
}));

router.get('/repos', authenticate, asyncHandler(async (req, res) => {
  res.json({ repos: await listRepos(req.user.id) });
}));

/** PUT /api/github/repos  body: { repoIds: number[] } */
router.put('/repos', authenticate, asyncHandler(async (req, res) => {
  const { repoIds } = req.body;
  if (!Array.isArray(repoIds)) {
    return res.status(400).json({ error: 'repoIds must be an array' });
  }
  res.json({ repos: await setSelectedRepos(req.user.id, repoIds) });
}));

router.post('/scan-now', authenticate, asyncHandler(async (req, res) => {
  res.json(await scanCommits(req.user.id, { timezone: req.body?.timezone }));
}));

router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const { scanFrequency, enabled } = req.body;
  res.json(await updateGithubSettings(req.user.id, { scanFrequency, enabled }));
}));

router.post('/disconnect', authenticate, asyncHandler(async (req, res) => {
  res.json(await disconnectGithub(req.user.id));
}));

export default router;
