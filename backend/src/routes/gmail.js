import express from 'express';
import {
  getAuthUrl,
  handleOAuthCallback,
  scanEmails,
  getGmailStatus,
  disconnectGmail,
  updateGmailSettings,
} from '../services/gmailService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/gmail/connect
 * Initiate Gmail OAuth flow
 */
router.post('/connect', authenticate, asyncHandler(async (req, res) => {
  const authUrl = getAuthUrl(req.user.id);
  res.json({ authUrl });
}));

/**
 * GET /api/gmail/callback
 * Handle OAuth callback
 */
router.get('/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code missing' });
  }

  if (!state) {
    return res.status(400).json({ error: 'User ID missing' });
  }

  const userId = parseInt(state, 10);
  
  try {
    const result = await handleOAuthCallback(code, userId);
    
    // Redirect to frontend with success message
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?gmail=connected&email=${encodeURIComponent(result.email)}`);
  } catch (error) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?gmail=error&message=${encodeURIComponent(error.message)}`);
  }
}));

/**
 * GET /api/gmail/status
 * Get Gmail connection status
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getGmailStatus(req.user.id);
  res.json(status);
}));

/**
 * POST /api/gmail/scan-now
 * Manually trigger email scan
 */
router.post('/scan-now', authenticate, asyncHandler(async (req, res) => {
  const { maxEmails = 50 } = req.body;
  const result = await scanEmails(req.user.id, maxEmails);
  res.json(result);
}));

/**
 * PUT /api/gmail/settings
 * Update Gmail settings
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

  const result = await updateGmailSettings(req.user.id, settings);
  res.json(result);
}));

/**
 * POST /api/gmail/disconnect
 * Disconnect Gmail integration
 */
router.post('/disconnect', authenticate, asyncHandler(async (req, res) => {
  const result = await disconnectGmail(req.user.id);
  res.json(result);
}));

export default router;
