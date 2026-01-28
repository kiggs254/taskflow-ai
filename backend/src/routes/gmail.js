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
  
  console.log('Reply request:', { taskId, hasMessage: !!message, polishWithAI, userId: req.user.id });
  
  if (!taskId || !message) {
    return res.status(400).json({ error: 'taskId and message are required' });
  }

  try {
    const result = await replyToEmail(
      req.user.id,
      taskId,
      message,
      polishWithAI || false,
      polishInstructions || ''
    );
    
    console.log('Reply sent successfully');
    res.json(result);
  } catch (error) {
    console.error('Error in reply endpoint:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return res.status(500).json({ 
      error: 'Failed to send email reply: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
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

  // Get user's name for sign-off
  const { query } = await import('../config/database.js');
  const userResult = await query('SELECT username FROM users WHERE id = $1', [req.user.id]);
  const userName = userResult.rows[0]?.username || '';

  const polishedMessage = await polishEmailReply(message, 'openai', instructions || '', userName);
  
  res.json({ polishedMessage });
}));

/**
 * POST /api/gmail/generate-draft
 * Generate AI email draft based on task context
 */
router.post('/generate-draft', authenticate, asyncHandler(async (req, res) => {
  try {
    const { taskId, message, style } = req.body;
    
    console.log('Enhance message request received:', { 
      taskId, 
      style, 
      hasMessage: !!message,
      messageLength: message?.length || 0,
      userId: req.user.id,
    });
    
    // Validate request
    if (!taskId) {
      console.error('Enhance message failed: taskId is required');
      return res.status(400).json({ error: 'taskId is required' });
    }
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.error('Enhance message failed: message is required');
      return res.status(400).json({ error: 'message is required' });
    }
    
    if (!style || (style !== 'short' && style !== 'detailed')) {
      console.error('Enhance message failed: style must be "short" or "detailed"');
      return res.status(400).json({ error: 'style must be "short" or "detailed"' });
    }

    // Get user's name
    const { query } = await import('../config/database.js');
    let userName = '';
    try {
      const userResult = await query(
        'SELECT username FROM users WHERE id = $1',
        [req.user.id]
      );
      userName = userResult.rows[0]?.username || '';
      console.log('User name retrieved:', userName || 'not set');
    } catch (userError) {
      console.error('Error fetching user name:', userError);
      // Continue without userName - not critical
    }
    
    // Get task for context (optional, but helpful)
    let taskContext = '';
    try {
      const taskResult = await query(
        'SELECT title, description FROM tasks WHERE id = $1 AND user_id = $2',
        [taskId, req.user.id]
      );

      if (taskResult.rows.length > 0) {
        const task = taskResult.rows[0];
        // Extract clean description (remove metadata)
        const cleanDescription = task.description
          ? task.description.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '').trim()
          : '';
        taskContext = `Task: ${task.title}${cleanDescription ? `\nContext: ${cleanDescription.substring(0, 500)}` : ''}`;
      }
    } catch (taskError) {
      console.warn('Error fetching task context:', taskError);
      // Continue without context - not critical
    }

    console.log('Enhancing message with AI:', { 
      style,
      userName: userName || 'not set',
      messageLength: message.length,
      hasContext: !!taskContext
    });
    
    // Enhance message with AI
    try {
      const { enhanceEmailMessage } = await import('../services/aiService.js');
      const enhanced = await enhanceEmailMessage(
        message,
        style,
        'openai', // Will use fallback logic automatically
        taskContext,
        userName
      );
      
      if (!enhanced || typeof enhanced !== 'string') {
        console.error('AI returned invalid enhanced message:', { enhanced, type: typeof enhanced });
        return res.status(500).json({ error: 'AI returned invalid format' });
      }
      
      console.log('Message enhanced successfully, length:', enhanced.length);
      return res.json({ draft: enhanced });
    } catch (aiError) {
      console.error('AI Error enhancing message:', {
        message: aiError.message,
        stack: aiError.stack,
        name: aiError.name,
        cause: aiError.cause,
        type: aiError.constructor.name,
      });
      return res.status(500).json({ 
        error: 'Failed to enhance message: ' + aiError.message,
        details: process.env.NODE_ENV === 'development' ? aiError.stack : undefined
      });
    }
  } catch (error) {
    // Catch any unexpected errors
    console.error('Unexpected error in generate-draft endpoint:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      type: error.constructor.name,
    });
    return res.status(500).json({ 
      error: 'Internal server error: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}));

export default router;
