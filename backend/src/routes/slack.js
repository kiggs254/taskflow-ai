import express from 'express';
import {
  getAuthUrl,
  handleOAuthCallback,
  scanSlackMentions,
  getSlackStatus,
  disconnectSlack,
  updateSlackSettings,
  postDailySummaryToSlack,
} from '../services/slackService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/slack/connect
 * Initiate Slack OAuth flow
 */
router.post('/connect', authenticate, asyncHandler(async (req, res) => {
  const authUrl = getAuthUrl(req.user.id);
  res.json({ authUrl });
}));

/**
 * GET /api/slack/callback
 * Handle OAuth callback
 * NOTE: This route does NOT require authentication as it's called by Slack OAuth
 */
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    
    console.log('Slack OAuth callback received:', { code: code ? 'present' : 'missing', state, error });
    
    if (error) {
      console.error('Slack OAuth error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?slack=error&message=${encodeURIComponent(error)}`);
    }
    
    if (!code) {
      console.error('Slack callback: Authorization code missing');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?slack=error&message=${encodeURIComponent('Authorization code missing')}`);
    }

    if (!state) {
      console.error('Slack callback: User ID (state) missing');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?slack=error&message=${encodeURIComponent('User ID missing')}`);
    }

    const userId = parseInt(state, 10);
    
    if (isNaN(userId) || userId <= 0) {
      console.error('Slack callback: Invalid user ID:', state);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?slack=error&message=${encodeURIComponent('Invalid user ID')}`);
    }
    
    console.log('Slack callback: Processing for user ID:', userId);
    const result = await handleOAuthCallback(code, userId);
    console.log('Slack callback: Success for user:', userId, 'team:', result.teamName);
    
    // Redirect to frontend with success message
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?slack=connected&team=${encodeURIComponent(result.teamName)}`);
  } catch (error) {
    console.error('Slack callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const errorMessage = error.message || 'Failed to connect Slack';
    res.redirect(`${frontendUrl}/settings?slack=error&message=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * GET /api/slack/status
 * Get Slack connection status
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getSlackStatus(req.user.id);
  res.json(status);
}));

/**
 * POST /api/slack/scan-now
 * Manually trigger mention scan
 */
router.post('/scan-now', authenticate, asyncHandler(async (req, res) => {
  const { maxMentions = 50 } = req.body;
  const result = await scanSlackMentions(req.user.id, maxMentions);
  res.json(result);
}));

/**
 * PUT /api/slack/settings
 * Update Slack settings
 */
router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const { scanFrequency, enabled } = req.body;
  
  const settings = {};
  if (scanFrequency !== undefined) {
    settings.scanFrequency = parseInt(scanFrequency, 10);
  }
  if (enabled !== undefined) {
    settings.enabled = Boolean(enabled);
  }

  const result = await updateSlackSettings(req.user.id, settings);
  res.json(result);
}));

/**
 * POST /api/slack/disconnect
 * Disconnect Slack integration
 */
router.post('/disconnect', authenticate, asyncHandler(async (req, res) => {
  const result = await disconnectSlack(req.user.id);
  res.json(result);
}));

/**
 * POST /api/slack/daily-summary
 * Post a daily summary of completed tasks to Slack
 */
router.post('/daily-summary', authenticate, asyncHandler(async (req, res) => {
  const { tasks, dateLabel } = req.body;
  const result = await postDailySummaryToSlack(req.user.id, tasks || [], dateLabel);
  res.json(result);
}));

export default router;
