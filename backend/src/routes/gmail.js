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
 * NOTE: This route does NOT require authentication as it's called by Google OAuth
 * We don't use asyncHandler here to have full control over error handling and redirects
 */
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    
    console.log('Gmail OAuth callback received:', { code: code ? 'present' : 'missing', state });
    
    if (!code) {
      console.error('Gmail callback: Authorization code missing');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?gmail=error&message=${encodeURIComponent('Authorization code missing')}`);
    }

    if (!state) {
      console.error('Gmail callback: User ID (state) missing');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?gmail=error&message=${encodeURIComponent('User ID missing')}`);
    }

    const userId = parseInt(state, 10);
    
    if (isNaN(userId) || userId <= 0) {
      console.error('Gmail callback: Invalid user ID:', state);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/settings?gmail=error&message=${encodeURIComponent('Invalid user ID')}`);
    }
    
    console.log('Gmail callback: Processing for user ID:', userId);
    const result = await handleOAuthCallback(code, userId);
    console.log('Gmail callback: Success for user:', userId, 'email:', result.email);
    
    // Redirect to frontend with success message
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?gmail=connected&email=${encodeURIComponent(result.email)}`);
  } catch (error) {
    console.error('Gmail callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const errorMessage = error.message || 'Failed to connect Gmail';
    // Don't call next() - we want to redirect, not return JSON
    res.redirect(`${frontendUrl}/settings?gmail=error&message=${encodeURIComponent(errorMessage)}`);
  }
});

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
  const { scanFrequency, enabled, promptInstructions } = req.body;
  
  const settings = {};
  if (scanFrequency !== undefined) {
    settings.scanFrequency = parseInt(scanFrequency, 10);
  }
  if (enabled !== undefined) {
    settings.enabled = Boolean(enabled);
  }
  if (promptInstructions !== undefined) {
    settings.promptInstructions = promptInstructions;
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
