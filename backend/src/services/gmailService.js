import { google } from 'googleapis';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import crypto from 'crypto';
import { parseTask, parseEmailThread, checkEmailRelevance } from './aiService.js';
import { createDraftTask, draftTaskExists, taskExistsForSource } from './draftTaskService.js';
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
 * Process email thread and extract structured information with AI
 */
const processEmailThread = async (fullThreadContent, promptInstructions = '') => {
  try {
    const result = await parseEmailThread(fullThreadContent, 'openai', promptInstructions);
    return result;
  } catch (error) {
    console.error('Error processing email thread:', error);
    // Fallback to basic parsing
    return {
      title: null,
      description: fullThreadContent.substring(0, 2000),
      todos: [],
    };
  }
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
    // Exclude sent emails - we only want to scan received emails
    let queryString = '-in:sent';
    
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
    const createdTasks = [];
    let tasksCreated = 0;

    // Process each email
    for (const message of messages) {
      try {
        // === DUPLICATE CHECK: Skip if already processed ===
        const draftExists = await draftTaskExists(userId, 'gmail', message.id);
        if (draftExists) {
          console.log(`Skipping email ${message.id}: draft already exists`);
          continue;
        }
        
        const taskExists = await taskExistsForSource(userId, message.id);
        if (taskExists) {
          console.log(`Skipping email ${message.id}: task already exists`);
          continue;
        }

        // Get full message
        const messageData = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });

        const email = messageData.data;
        const threadId = email.threadId;
        
        // Get full thread to process all messages
        const threadData = await gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'full',
        });

        const thread = threadData.data;
        
        // Extract participants from all messages in thread
        const allParticipants = {
          from: new Set(),
          to: new Set(),
          cc: new Set(),
          bcc: new Set(),
        };

        let fullThreadContent = '';
        let latestMessage = email;
        let latestSubject = 'No Subject';
        let latestDate = null;

        // Process all messages in thread
        for (const threadMessage of thread.messages || []) {
          const msgHeaders = threadMessage.payload.headers;
          const msgFrom = msgHeaders.find(h => h.name === 'From')?.value;
          const msgTo = msgHeaders.find(h => h.name === 'To')?.value;
          const msgCc = msgHeaders.find(h => h.name === 'Cc')?.value;
          const msgBcc = msgHeaders.find(h => h.name === 'Bcc')?.value;
          const msgSubject = msgHeaders.find(h => h.name === 'Subject')?.value;
          const msgDate = msgHeaders.find(h => h.name === 'Date')?.value;

          if (msgFrom) allParticipants.from.add(msgFrom);
          if (msgTo) {
            msgTo.split(',').forEach(addr => allParticipants.to.add(addr.trim()));
          }
          if (msgCc) {
            msgCc.split(',').forEach(addr => allParticipants.cc.add(addr.trim()));
          }
          if (msgBcc) {
            msgBcc.split(',').forEach(addr => allParticipants.bcc.add(addr.trim()));
          }

          // Extract body text from this message
          let msgBodyText = '';
          if (threadMessage.payload.body?.data) {
            msgBodyText = Buffer.from(threadMessage.payload.body.data, 'base64').toString('utf-8');
          } else if (threadMessage.payload.parts) {
            for (const part of threadMessage.payload.parts) {
              if (part.mimeType === 'text/plain' && part.body?.data) {
                msgBodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
              }
            }
          }

          // Build thread content
          fullThreadContent += `\n\n--- Message from ${msgFrom} ---\n`;
          fullThreadContent += `Date: ${msgDate || 'Unknown'}\n`;
          fullThreadContent += `Subject: ${msgSubject || 'No Subject'}\n`;
          fullThreadContent += `To: ${msgTo || 'N/A'}\n`;
          if (msgCc) fullThreadContent += `CC: ${msgCc}\n`;
          fullThreadContent += `\n${msgBodyText}`;

          // Keep track of latest message
          if (threadMessage.id === message.id) {
            latestMessage = threadMessage;
            latestSubject = msgSubject || 'No Subject';
            latestDate = msgDate;
          }
        }

        // Extract email data from latest message
        const headers = latestMessage.payload.headers;
        const subject = latestSubject;
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const date = latestDate;
        
        // Extract body text from latest message
        let bodyText = '';
        if (latestMessage.payload.body?.data) {
          bodyText = Buffer.from(latestMessage.payload.body.data, 'base64').toString('utf-8');
        } else if (latestMessage.payload.parts) {
          for (const part of latestMessage.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }

        // Process full thread with AI
        const threadResult = await processEmailThread(fullThreadContent, promptInstructions || '');
        
        // Store email metadata
        const emailMetadata = {
          threadId: threadId,
          messageId: message.id,
          participants: {
            from: Array.from(allParticipants.from),
            to: Array.from(allParticipants.to),
            cc: Array.from(allParticipants.cc),
            bcc: Array.from(allParticipants.bcc),
          },
          subject: subject,
          date: date,
        };

        // === RELEVANCE CHECK: Use AI to check if email matches user's dos/don'ts ===
        // Only apply filter if user has provided meaningful instructions
        if (promptInstructions && promptInstructions.trim().length > 10) {
          const emailSummary = `Subject: ${subject}\nFrom: ${from}\n\n${bodyText.substring(0, 1500)}`;
          const relevanceCheck = await checkEmailRelevance(emailSummary, promptInstructions, 'openai');
          
          if (!relevanceCheck.isRelevant) {
            console.log(`Skipping email ${message.id} (${subject}): Not relevant - ${relevanceCheck.reason}`);
            continue;
          }
          console.log(`Email ${message.id} (${subject}) approved: ${relevanceCheck.reason}`);
        } else {
          console.log(`Processing email ${message.id} (${subject}): No filter instructions`);
        }

        // Use AI to extract task (fallback if thread processing didn't provide title)
        try {
          const aiResult = await parseTask(
            `Subject: ${subject}\n\nFrom: ${from}\n\n${bodyText.substring(0, 2000)}`,
            'openai',
            promptInstructions || ''
          );
          
          // Use thread result description if available, otherwise use basic description
          const description = threadResult.description 
            ? `${threadResult.description}\n\n<!-- Email metadata: ${JSON.stringify(emailMetadata)} -->`
            : `From: ${from}\nSubject: ${subject}\n\n${bodyText.substring(0, 1000)}\n\n<!-- Email metadata: ${JSON.stringify(emailMetadata)} -->`;
          
          // Get subtasks from AI extraction (if available)
          const subtasks = threadResult.subtasks || [];
          
          // Get meeting link from AI extraction or extract manually
          let meetingLink = threadResult.meetingLink || null;
          if (!meetingLink) {
            // Fallback: try to extract meeting link from body
            const meetingPatterns = [
              /https:\/\/[\w.-]*zoom\.us\/[^\s<>"')]+/i,
              /https:\/\/meet\.google\.com\/[^\s<>"')]+/i,
              /https:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i,
              /https:\/\/[\w.-]*webex\.com\/[^\s<>"')]+/i,
            ];
            for (const pattern of meetingPatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                meetingLink = match[0];
                break;
              }
            }
          }
          
          const baseTaskData = {
            title: threadResult.title || aiResult?.title || subject || 'Email Task',
            description: description,
            // All integration-sourced tasks should default to Job
            workspace: 'job',
            energy: aiResult?.energy || 'medium',
            estimatedTime: aiResult?.estimatedTime || 15,
            tags: [...(aiResult?.tags || []), 'gmail'],
            aiConfidence: 0.8,
            subtasks, // Include AI-extracted subtasks
            meetingLink, // Include meeting link if found
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

            const newTask = {
              id: crypto.randomUUID(),
              ...baseTaskData,
              tags: meetingTags,
              status: 'todo',
              dependencies: [],
              subtasks, // Include subtasks in meeting tasks too
              meetingLink, // Include meeting link for easy join button
              createdAt: Date.now(),
              dueDate: meetingDueDate || null,
            };

            await syncTask(userId, newTask);
            createdTasks.push(newTask);
            tasksCreated++;
          } else {
            // Create draft task (with built-in duplicate check)
            const draftTask = await createDraftTask(userId, {
              source: 'gmail',
              sourceId: message.id,
              ...baseTaskData,
            });

            // Only add to array if task was actually created (not skipped as duplicate)
            if (draftTask) {
              draftTasks.push(draftTask);
            }
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

    // Filter out any null drafts (from duplicate skips)
    const validDrafts = draftTasks.filter(d => d !== null);
    
    return { success: true, draftsCreated: validDrafts.length, tasksCreated, tasks: createdTasks, drafts: validDrafts };
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

/**
 * Reply to email thread (Reply All)
 */
export const replyToEmail = async (userId, taskId, message, polishWithAI = false, polishInstructions = '') => {
  try {
    // Get task to extract email metadata
    const taskResult = await query(
      'SELECT description FROM tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    );

    if (taskResult.rows.length === 0) {
      throw new Error('Task not found');
    }

    const taskDescription = taskResult.rows[0].description;
    
    // Extract email metadata from description
    const metadataMatch = taskDescription?.match(/<!-- Email metadata: ({.*?}) -->/);
    if (!metadataMatch) {
      throw new Error('Email metadata not found in task description');
    }

    let emailMetadata;
    try {
      emailMetadata = JSON.parse(metadataMatch[1]);
    } catch (e) {
      throw new Error('Invalid email metadata format');
    }

    const { threadId, messageId, participants, subject } = emailMetadata;
    if (!threadId || !messageId) {
      throw new Error('Missing threadId or messageId in metadata');
    }

    const gmail = await getGmailClient(userId);

    // Get original message to get headers
    const originalMessage = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'References'],
    });

    const headers = originalMessage.data.payload.headers;
    const originalFrom = headers.find(h => h.name === 'From')?.value;
    const originalTo = headers.find(h => h.name === 'To')?.value || '';
    const originalCc = headers.find(h => h.name === 'Cc')?.value || '';
    const originalMessageId = headers.find(h => h.name === 'Message-ID')?.value || '';
    const originalReferences = headers.find(h => h.name === 'References')?.value || '';

    // Get user's email and name
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;
    
    // Get user's full name from database
    const userResult = await query('SELECT name FROM users WHERE id = $1', [userId]);
    const userName = userResult.rows[0]?.name || '';
    
    // Format From header with name if available
    const fromHeader = userName 
      ? `From: "${userName}" <${userEmail}>`
      : `From: ${userEmail}`;

    // Build Reply All recipients (exclude user's own email)
    const replyTo = originalTo.split(',').map(e => e.trim()).filter(e => !e.includes(userEmail));
    const replyCc = originalCc.split(',').map(e => e.trim()).filter(e => !e.includes(userEmail));
    
    // Add original sender to To if not already there
    if (originalFrom && !replyTo.some(e => e.includes(originalFrom.split('<')[1]?.split('>')[0] || originalFrom))) {
      replyTo.unshift(originalFrom);
    }

    // Polish message with AI if requested
    let finalMessage = message;
    if (polishWithAI) {
      const { polishEmailReply } = await import('./aiService.js');
      finalMessage = await polishEmailReply(message, 'openai', polishInstructions);
    }

    // Build email message
    const emailLines = [
      fromHeader,
      `To: ${replyTo.join(', ')}`,
    ];
    
    if (replyCc.length > 0) {
      emailLines.push(`Cc: ${replyCc.join(', ')}`);
    }
    
    emailLines.push(`Subject: Re: ${subject}`);
    
    if (originalMessageId) {
      emailLines.push(`In-Reply-To: ${originalMessageId}`);
      emailLines.push(`References: ${originalReferences ? originalReferences + ' ' : ''}${originalMessageId}`);
    }
    
    emailLines.push('', finalMessage);

    const emailContent = emailLines.join('\n');

    // Encode message
    const encodedMessage = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send reply
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        threadId: threadId,
        raw: encodedMessage,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error replying to email:', error);
    throw error;
  }
};
