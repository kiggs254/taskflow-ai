import express from 'express';
import {
  getAuthUrl,
  handleOAuthCallback,
  scanSlackMentions,
  getSlackStatus,
  disconnectSlack,
  updateSlackSettings,
  postDailySummaryToSlack,
  handleSlackEvent,
} from '../services/slackService.js';
import { sendNotification } from '../services/telegramService.js';
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
  const { maxMentions = 50, todayOnly = true } = req.body; // Default to today only for manual scans
  const result = await scanSlackMentions(req.user.id, maxMentions, todayOnly);
  
  // Send Telegram notification if tasks were created
  if (result && result.tasksCreated > 0) {
    try {
      const taskTitles = result.tasks?.map(t => `• ${t.title}`).join('\n') || '';
      const message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Slack:\n${taskTitles}`;
      await sendNotification(req.user.id, message);
    } catch (notifError) {
      console.error(`Error sending Telegram notification for user ${req.user.id}:`, notifError);
      // Don't fail the scan if notification fails
    }
  }
  
  res.json(result);
}));

/**
 * PUT /api/slack/settings
 * Update Slack settings
 */
router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const { scanFrequency, enabled, notificationsEnabled } = req.body;
  
  const settings = {};
  if (scanFrequency !== undefined) {
    settings.scanFrequency = parseInt(scanFrequency, 10);
  }
  if (enabled !== undefined) {
    settings.enabled = Boolean(enabled);
  }
  if (notificationsEnabled !== undefined) {
    settings.notificationsEnabled = Boolean(notificationsEnabled);
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
 * POST /api/slack/reset-scan
 * Reset the scan timestamp to allow re-scanning older messages
 */
router.post('/reset-scan', authenticate, asyncHandler(async (req, res) => {
  const { daysBack = 7 } = req.body;
  const resetDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  
  const { query } = await import('../config/database.js');
  await query(
    'UPDATE slack_integrations SET last_scan_at = $1 WHERE user_id = $2',
    [resetDate.toISOString(), req.user.id]
  );
  
  res.json({ 
    success: true, 
    message: `Scan reset to ${daysBack} days ago. Next scan will pick up older messages.`,
    resetTo: resetDate.toISOString()
  });
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

/**
 * POST /api/slack/events
 * Handle Slack Events API webhook (public endpoint, no auth required)
 * Used for bot commands like /add in DMs
 * Note: Slack sends JSON body, but we need to handle raw body for signature verification
 * For now, we'll parse JSON directly since express.json() middleware handles it
 */
router.post('/events', asyncHandler(async (req, res) => {
  const event = req.body;

  // Handle URL verification challenge
  if (event.type === 'url_verification') {
    return res.json({ challenge: event.challenge });
  }

  // Verify request signature (optional but recommended for production)
  // TODO: Add signature verification using SLACK_SIGNING_SECRET
  // For now, we'll process the event

  try {
    const result = await handleSlackEvent(event);
    res.json(result);
  } catch (error) {
    console.error('Slack events webhook error:', error);
    res.status(500).json({ error: 'Failed to process Slack event' });
  }
}));

export default router;
