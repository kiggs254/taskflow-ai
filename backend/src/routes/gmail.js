import express from 'express';
import {
  getAuthUrl,
  handleOAuthCallback,
  scanEmails,
  getGmailStatus,
  disconnectGmail,
  updateGmailSettings,
  replyToEmail,
} from '../services/gmailService.js';
import { polishEmailReply, generateEmailDraft } from '../services/aiService.js';
import { sendNotification } from '../services/telegramService.js';
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
  
  // Send Telegram notification if tasks were created
  if (result && (result.draftsCreated > 0 || result.tasksCreated > 0)) {
    try {
      let message = '';
      const taskTitles = result.tasks?.map(t => `• ${t.title}`).join('\n') || '';
      const draftTitles = result.drafts?.map(d => `• ${d.title}`).join('\n') || '';
      
      if (result.tasksCreated > 0 && result.draftsCreated > 0) {
        message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}\n\n📝 ${result.draftsCreated} draft task${result.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
      } else if (result.tasksCreated > 0) {
        message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}`;
      } else if (result.draftsCreated > 0) {
        message = `📝 ${result.draftsCreated} draft task${result.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
      }
      
      if (message) {
        await sendNotification(req.user.id, message);
      }
    } catch (notifError) {
      console.error(`Error sending Telegram notification for user ${req.user.id}:`, notifError);
      // Don't fail the scan if notification fails
    }
  }
  
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

/**
 * POST /api/gmail/reply
 * Reply to email thread (Reply All)
 */
router.post('/reply', authenticate, asyncHandler(async (req, res) => {
  const { taskId, message, polishWithAI, polishInstructions } = req.body;
  
  if (!taskId || !message) {
    return res.status(400).json({ error: 'taskId and message are required' });
  }

  const result = await replyToEmail(
    req.user.id,
    taskId,
    message,
    polishWithAI || false,
    polishInstructions || ''
  );
  
  res.json(result);
}));

/**
 * POST /api/gmail/polish-reply
 * Polish email reply with AI
 */
router.post('/polish-reply', authenticate, asyncHandler(async (req, res) => {
  const { message, instructions } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const polishedMessage = await polishEmailReply(message, 'openai', instructions || '');
  
  res.json({ polishedMessage });
}));

/**
 * POST /api/gmail/generate-draft
 * Generate AI email draft based on task context
 */
router.post('/generate-draft', authenticate, asyncHandler(async (req, res) => {
  const { taskId, tone, customInstructions } = req.body;
  
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  // Get task details
  const { query } = await import('../config/database.js');
  const taskResult = await query(
    'SELECT title, description FROM tasks WHERE id = $1 AND user_id = $2',
    [taskId, req.user.id]
  );

  if (taskResult.rows.length === 0) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const task = taskResult.rows[0];
  
  // Extract email metadata to get subject
  const emailMetadataMatch = task.description?.match(/<!-- Email metadata: ({.*?}) -->/);
  let emailSubject = '';
  if (emailMetadataMatch) {
    try {
      const metadata = JSON.parse(emailMetadataMatch[1]);
      emailSubject = metadata.subject || '';
    } catch (e) {
      // Ignore parse errors
    }
  }

  const draft = await generateEmailDraft(
    task.title,
    task.description || '',
    emailSubject,
    tone || 'professional',
    'openai',
    customInstructions || ''
  );
  
  res.json({ draft });
}));

export default router;
