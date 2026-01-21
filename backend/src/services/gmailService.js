import { google } from 'googleapis';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import crypto from 'crypto';
import { parseTask } from './aiService.js';
import { createDraftTask } from './draftTaskService.js';
import { syncTask } from './taskService.js';
import { config } from '../config/env.js';

const OAuth2Client = google.auth.OAuth2;

/**
 * Get OAuth2 client instance
 */
const getOAuth2Client = () => {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${config.cors.origin}/api/gmail/callback`
  );
};

/**
 * Generate OAuth2 authorization URL
 */
export const getAuthUrl = (userId) => {
  const oauth2Client = getOAuth2Client();
  
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify', // For marking emails as read
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state: userId.toString(), // Pass user ID in state
  });

  return url;
};

/**
 * Handle OAuth2 callback and store tokens
 */
export const handleOAuthCallback = async (code, userId) => {
  // Validate environment variables
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Gmail OAuth credentials not configured');
  }

  const oauth2Client = getOAuth2Client();
  
  try {
    console.log('Exchanging authorization code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }
    
    console.log('Tokens received, getting user profile...');
    // Get user's email from Gmail API
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;
    
    if (!email) {
      throw new Error('Could not retrieve email from Gmail profile');
    }
    
    console.log('Profile retrieved, email:', email);

    // Encrypt tokens
    console.log('Encrypting tokens...');
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = encrypt(tokens.refresh_token);
    
    if (!encryptedAccessToken || !encryptedRefreshToken) {
      throw new Error('Failed to encrypt tokens');
    }

    // Calculate token expiration
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // Default 1 hour

    // Store or update integration
    console.log('Storing integration in database for user:', userId);
    await query(
    `INSERT INTO gmail_integrations (user_id, email, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, email) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       enabled = true`,
    [userId, email, encryptedAccessToken, encryptedRefreshToken, expiresAt]
    );

    // Update user's gmail_connected flag
    await query(
      'UPDATE users SET gmail_connected = true WHERE id = $1',
      [userId]
    );

    console.log('Gmail integration stored successfully');
    return { success: true, email };
  } catch (error) {
    console.error('Gmail OAuth callback error details:', {
      message: error.message,
      stack: error.stack,
      userId,
    });
    throw new Error(`Failed to connect Gmail: ${error.message}`);
  }
};

/**
 * Get Gmail client for a user (with token refresh)
 */
const getGmailClient = async (userId) => {
  const result = await query(
    'SELECT email, access_token, refresh_token, token_expires_at FROM gmail_integrations WHERE user_id = $1 AND enabled = true',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Gmail not connected');
  }

  const integration = result.rows[0];
  const oauth2Client = getOAuth2Client();

  // Check if token needs refresh
  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();
  
  if (now >= expiresAt || now >= new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
    // Token expired or expiring soon, refresh it
    try {
      oauth2Client.setCredentials({
        refresh_token: decrypt(integration.refresh_token),
      });

      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update stored token
      const encryptedAccessToken = encrypt(credentials.access_token);
      const newExpiresAt = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

      await query(
        'UPDATE gmail_integrations SET access_token = $1, token_expires_at = $2 WHERE user_id = $3',
        [encryptedAccessToken, newExpiresAt, userId]
      );

      oauth2Client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: decrypt(integration.refresh_token),
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      throw new Error('Failed to refresh Gmail token. Please reconnect.');
    }
  } else {
    // Use existing token
    oauth2Client.setCredentials({
      access_token: decrypt(integration.access_token),
      refresh_token: decrypt(integration.refresh_token),
    });
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
};

/**
 * Scan emails and extract tasks
 */
export const scanEmails = async (userId, maxEmails = 50) => {
  try {
    const gmail = await getGmailClient(userId);
    
    // Get integration settings
    let integrationResult;
    try {
      integrationResult = await query(
        'SELECT last_scan_at, prompt_instructions FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );
    } catch (error) {
      // Backwards compatibility if prompt_instructions column isn't present yet
      if (error?.code === '42703') {
        integrationResult = await query(
          'SELECT last_scan_at FROM gmail_integrations WHERE user_id = $1',
          [userId]
        );
        integrationResult.rows = integrationResult.rows.map((row) => ({ ...row, prompt_instructions: '' }));
      } else {
        throw error;
      }
    }
    
    const integrationSettings = integrationResult.rows[0] || {};
    const lastScanAt = integrationSettings.last_scan_at;
    const promptInstructions = integrationSettings.prompt_instructions || '';

    // Scan all mail. We rely on last_scan_at to avoid reprocessing instead of
    // filtering by label/category, so the user can control relevance via prompt instructions.
    let queryString = '';
    
    if (lastScanAt) {
      // Only get emails after last scan
      const lastScanTimestamp = Math.floor(new Date(lastScanAt).getTime() / 1000);
      queryString += ` after:${lastScanTimestamp}`;
    }

    // List messages
    const listParams = {
      userId: 'me',
      maxResults: maxEmails,
    };
    if (queryString.trim()) {
      listParams.q = queryString.trim();
    }

    const messagesResponse = await gmail.users.messages.list(listParams);

    const messages = messagesResponse.data.messages || [];
    console.log(`Gmail scan: found ${messages.length} message(s) for user ${userId} with query "${queryString}"`);
    const draftTasks = [];

    // Process each email
    for (const message of messages) {
      try {
        // Get full message
        const messageData = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });

        const email = messageData.data;
        
        // Extract email data
        const headers = email.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const date = headers.find(h => h.name === 'Date')?.value;
        
        // Extract body text
        let bodyText = '';
        if (email.payload.body?.data) {
          bodyText = Buffer.from(email.payload.body.data, 'base64').toString('utf-8');
        } else if (email.payload.parts) {
          for (const part of email.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }

        // Combine subject and body for AI analysis
        const emailContent = `Subject: ${subject}\n\nFrom: ${from}\n\n${bodyText.substring(0, 2000)}`;

        // Use AI to extract task
        try {
          const aiResult = await parseTask(emailContent, 'openai', promptInstructions || '');
          
          const baseTaskData = {
            title: aiResult?.title || subject || 'Email Task',
            description: `From: ${from}\nSubject: ${subject}\n\n${bodyText.substring(0, 1000)}`,
            // All integration-sourced tasks should default to Job
            workspace: 'job',
            energy: aiResult?.energy || 'medium',
            estimatedTime: aiResult?.estimatedTime || 15,
            tags: [...(aiResult?.tags || []), 'gmail'],
            aiConfidence: 0.8,
          };

          const contentLower = `${subject} ${bodyText}`.toLowerCase();
          const looksLikeEvent =
            contentLower.includes('meeting') ||
            contentLower.includes('invite') ||
            contentLower.includes('invitation') ||
            contentLower.includes('event') ||
            contentLower.includes('calendar') ||
            contentLower.includes('zoom') ||
            contentLower.includes('google meet') ||
            contentLower.includes('teams');

          if (looksLikeEvent) {
            // Treat as meeting: tag and attach a date/time based on email Date header
            const meetingTags = [...baseTaskData.tags, 'meeting'];
            const meetingDueDate = date ? new Date(date).getTime() : undefined;

            await syncTask(userId, {
              id: crypto.randomUUID(),
              ...baseTaskData,
              tags: meetingTags,
              status: 'todo',
              dependencies: [],
              createdAt: Date.now(),
              dueDate: meetingDueDate || null,
            });
          } else {
            // Create draft task
            const draftTask = await createDraftTask(userId, {
              source: 'gmail',
              sourceId: message.id,
              ...baseTaskData,
            });

            draftTasks.push(draftTask);
          }
        } catch (aiError) {
          console.error(`AI parsing error for email ${message.id}:`, aiError);
          // Continue with next email
        }

        // Mark email as read (optional - could be configurable)
        // await gmail.users.messages.modify({
        //   userId: 'me',
        //   id: message.id,
        //   requestBody: { removeLabelIds: ['UNREAD'] },
        // });

      } catch (error) {
        console.error(`Error processing email ${message.id}:`, error);
        // Continue with next email
      }
    }

    // Update last_scan_at
    await query(
      'UPDATE gmail_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );

    return { success: true, draftsCreated: draftTasks.length, drafts: draftTasks };
  } catch (error) {
    console.error('Email scanning error:', error);
    throw error;
  }
};

/**
 * Get Gmail connection status
 */
export const getGmailStatus = async (userId) => {
  let result;
  try {
    result = await query(
      `SELECT email, enabled, last_scan_at, scan_frequency, prompt_instructions, created_at
       FROM gmail_integrations WHERE user_id = $1`,
      [userId]
    );
  } catch (error) {
    // Backwards compatibility: older DBs may not have prompt_instructions yet
    if (error?.code === '42703') {
      result = await query(
        `SELECT email, enabled, last_scan_at, scan_frequency, created_at
         FROM gmail_integrations WHERE user_id = $1`,
        [userId]
      );
      // Normalize shape to include prompt_instructions as null
      result.rows = result.rows.map((row) => ({ ...row, prompt_instructions: null }));
    } else {
      throw error;
    }
  }

  if (result.rows.length === 0) {
    return { connected: false };
  }

  return {
    connected: true,
    email: result.rows[0].email,
    enabled: result.rows[0].enabled,
    lastScanAt: result.rows[0].last_scan_at,
    scanFrequency: result.rows[0].scan_frequency,
    promptInstructions: result.rows[0].prompt_instructions,
    createdAt: result.rows[0].created_at,
  };
};

/**
 * Disconnect Gmail
 */
export const disconnectGmail = async (userId) => {
  await query(
    'DELETE FROM gmail_integrations WHERE user_id = $1',
    [userId]
  );

  await query(
    'UPDATE users SET gmail_connected = false WHERE id = $1',
    [userId]
  );

  return { success: true };
};

/**
 * Update Gmail settings
 */
export const updateGmailSettings = async (userId, settings) => {
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (settings.scanFrequency !== undefined) {
    updates.push(`scan_frequency = $${paramCount++}`);
    values.push(settings.scanFrequency);
  }
  if (settings.enabled !== undefined) {
    updates.push(`enabled = $${paramCount++}`);
    values.push(settings.enabled);
  }
  if (settings.promptInstructions !== undefined) {
    updates.push(`prompt_instructions = $${paramCount++}`);
    values.push(settings.promptInstructions);
  }

  if (updates.length === 0) {
    throw new Error('No settings to update');
  }

  values.push(userId);

  try {
    await query(
      `UPDATE gmail_integrations SET ${updates.join(', ')} WHERE user_id = $${paramCount++}`,
      values
    );
  } catch (error) {
    // If prompt_instructions doesn't exist yet, give a clear message
    if (error?.code === '42703' && settings.promptInstructions !== undefined) {
      throw new Error(
        "Gmail prompt instructions are not available yet because the database column 'prompt_instructions' is missing. Please run the migration to add it."
      );
    }
    throw error;
  }

  return { success: true };
};
