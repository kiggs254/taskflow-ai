import { google } from 'googleapis';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import crypto from 'crypto';
import { triageThread } from './emailTriage.js';
import { upsertProposal } from './proposalService.js';
import {
  filterUnprocessedGmailIds,
  markGmailMessageProcessed,
} from './processedMessageService.js';
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
    // Lets the monthly KPI report write itself into a Google Sheet using the same
    // Google account. Requested here rather than in a second connect flow; an account
    // linked before this scope existed must reconnect once to grant it.
    'https://www.googleapis.com/auth/spreadsheets',
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
    const result = await parseEmailThread(fullThreadContent, undefined, promptInstructions);
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
/**
 * Plain-text body of one Gmail message payload.
 *
 * Same logic the previous scanner inlined twice: prefer the top-level body, otherwise
 * concatenate the text/plain parts. Nested multipart is walked, which the inline version
 * did not do -- a multipart/alternative inside multipart/mixed returned nothing.
 */
export const extractEmailBody = (payload) => {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  let out = '';
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      out += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      out += extractEmailBody(part);
    }
  }
  return out;
};

export const scanEmails = async (userId, maxEmails = 50) => {
  try {
    const gmail = await getGmailClient(userId);

    let integrationResult;
    try {
      integrationResult = await query(
        'SELECT last_scan_at, prompt_instructions FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );
    } catch (error) {
      // Older DBs may not have prompt_instructions yet.
      if (error?.code === '42703') {
        integrationResult = await query(
          'SELECT last_scan_at FROM gmail_integrations WHERE user_id = $1',
          [userId]
        );
      } else {
        throw error;
      }
    }

    const lastScanAt = integrationResult.rows[0]?.last_scan_at;
    const instructions = integrationResult.rows[0]?.prompt_instructions || '';

    let queryString = '-in:sent';
    if (lastScanAt) {
      queryString += ` after:${Math.floor(new Date(lastScanAt).getTime() / 1000)}`;
    }

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: maxEmails,
      q: queryString,
    });

    const messages = messagesResponse.data.messages || [];
    if (messages.length === 0) {
      await query(
        'UPDATE gmail_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
      return { success: true, proposalsCreated: 0, skipped: 0, ignored: 0 };
    }

    // The immutable ledger, consulted before any fetch or AI billing.
    const unprocessedIds = await filterUnprocessedGmailIds(userId, messages.map((m) => m.id));
    const pending = messages.filter((m) => unprocessedIds.has(m.id));

    let proposalsCreated = 0;
    let ignored = 0;
    const seenThreads = new Set();

    for (const message of pending) {
      try {
        const messageData = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });
        const threadId = messageData.data.threadId;

        // ONE AI call per thread, not per message.
        //
        // The old loop fetched and parsed the thread once for every new message in it,
        // so three new messages in a conversation produced three near-identical drafts.
        // Later messages of an already-handled thread are still ledgered below, so they
        // are not reconsidered on the next scan.
        if (seenThreads.has(threadId)) {
          await markGmailMessageProcessed(userId, message.id, { outcome: 'thread_handled' });
          continue;
        }
        seenThreads.add(threadId);

        const threadData = await gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'full',
        });
        const threadMessages = threadData.data.messages || [];

        const header = (msg, name) =>
          msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value || '';

        const participants = new Set();
        let threadText = '';
        for (const msg of threadMessages) {
          const from = header(msg, 'from');
          const to = header(msg, 'to');
          [from, to, header(msg, 'cc')].forEach((v) => {
            v.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => participants.add(x));
          });
          threadText +=
            `\n--- ${header(msg, 'date')} | From: ${from} | To: ${to} ---\n` +
            `${extractEmailBody(msg.payload).slice(0, 6000)}\n`;
        }

        const latest = threadMessages[threadMessages.length - 1] || messageData.data;
        const subject = header(latest, 'subject');
        const from = header(latest, 'from');

        const verdict = await triageThread(userId, {
          subject,
          from,
          participants: [...participants],
          threadText,
          instructions,
        });

        // null = the model could not be reached. Leave the message UNledgered so the
        // next scan retries it. Treating an outage as "no reply needed" would silently
        // swallow real client mail, which is the failure mode this rewrite exists to end.
        if (!verdict) continue;

        if (!verdict.needsReply) {
          // Recorded with its reasoning, so a wrong call is reviewable rather than
          // invisible -- but nothing is created. This is the whole point.
          await markGmailMessageProcessed(userId, message.id, { outcome: 'no_reply_needed' });
          ignored++;
          continue;
        }

        await upsertProposal(userId, {
          threadId,
          lastMessageId: message.id,
          subject,
          from,
          classification: verdict.classification,
          summary: verdict.summary,
          reasoning: verdict.reasoning,
          draftReply: verdict.draftReply,
          threadMetadata: {
            threadId,
            messageId: message.id,
            participants: [...participants].slice(0, 20),
            // Only ever the model's explicit meeting time. The old code used the email's
            // own Date header here, which is why every task showed a meeting.
            meetingTime: verdict.meetingTime || null,
          },
        });
        await markGmailMessageProcessed(userId, message.id, { outcome: 'proposal' });
        proposalsCreated++;
      } catch (error) {
        console.error(`Error processing email ${message.id}:`, error.message);
        // Unledgered on purpose: retry next scan.
      }
    }

    await query(
      'UPDATE gmail_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );

    return {
      success: true,
      proposalsCreated,
      ignored,
      skipped: messages.length - pending.length,
    };
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
/**
 * Send a threaded reply.
 *
 * Split out of replyToEmail, which could only reply to an email that had become a TASK
 * (it read the metadata back out of the task's description). Proposals have no task, so
 * the sending half -- reply-all recipient building, MIME assembly, In-Reply-To/References
 * threading -- lives here and both callers share it. This is the only function in the
 * codebase that puts mail in front of anyone.
 */
export const sendThreadReply = async (
  userId,
  { threadId, messageId, subject, message, polishWithAI = false, polishInstructions = '' }
) => {
  try {
    if (!threadId || !messageId) {
      throw new Error('Missing threadId or messageId');
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

    // Get user's email and name for From header
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;
    
    // Get user's name from database (using username column)
    const userResult = await query('SELECT username FROM users WHERE id = $1', [userId]);
    const userName = userResult.rows[0]?.username || '';

    // Build Reply All recipients (exclude user's own email)
    let replyTo = originalTo ? originalTo.split(',').map(e => e.trim()).filter(e => e && !e.includes(userEmail)) : [];
    let replyCc = originalCc ? originalCc.split(',').map(e => e.trim()).filter(e => e && !e.includes(userEmail)) : [];
    
    // Add original sender to To if not already there
    if (originalFrom) {
      const originalFromEmail = originalFrom.includes('<') 
        ? originalFrom.split('<')[1]?.split('>')[0] 
        : originalFrom;
      const alreadyInTo = replyTo.some(e => {
        const email = e.includes('<') ? e.split('<')[1]?.split('>')[0] : e;
        return email && email === originalFromEmail;
      });
      if (!alreadyInTo) {
        replyTo.unshift(originalFrom);
      }
    }
    
    // Ensure we have at least one recipient
    if (replyTo.length === 0) {
      throw new Error('No valid recipients found for reply');
    }

    // Polish message with AI if requested
    let finalMessage = message;
    if (polishWithAI) {
      const { polishEmailReply } = await import('./aiService.js');
      finalMessage = await polishEmailReply(message, undefined, polishInstructions, userName);
    }
    
    // Validate message
    if (!finalMessage || typeof finalMessage !== 'string' || finalMessage.trim().length === 0) {
      throw new Error('Email message is empty');
    }
    
    // Ensure message doesn't start with headers (security check)
    if (finalMessage.includes('\nFrom:') || finalMessage.includes('\r\nFrom:')) {
      throw new Error('Email message contains invalid header-like content');
    }

    // Build email message with proper MIME formatting
    // Gmail API will automatically set From to match authenticated user
    // We include From header but ensure email matches authenticated user exactly
    // The display name can be included but email must match
    const fromHeader = userName 
      ? `From: "${userName}" <${userEmail}>`
      : `From: ${userEmail}`;
    
    // Build headers in proper order (From, To, Cc, Subject, then MIME headers, then threading headers)
    const emailLines = [
      fromHeader,
      `To: ${replyTo.join(', ')}`,
    ];
    
    if (replyCc.length > 0) {
      emailLines.push(`Cc: ${replyCc.join(', ')}`);
    }
    
    emailLines.push(`Subject: Re: ${subject}`);
    
    // MIME headers
    emailLines.push(`MIME-Version: 1.0`);
    emailLines.push(`Content-Type: text/plain; charset=UTF-8`);
    emailLines.push(`Content-Transfer-Encoding: 7bit`);
    
    // Threading headers
    if (originalMessageId) {
      emailLines.push(`In-Reply-To: ${originalMessageId}`);
      emailLines.push(`References: ${originalReferences ? originalReferences + ' ' : ''}${originalMessageId}`);
    }
    
    // Blank line separates headers from body (required by MIME standard)
    emailLines.push('');
    emailLines.push(finalMessage);

    // Use \r\n for proper email line endings (RFC 2822 standard)
    const emailContent = emailLines.join('\r\n');
    
    // Validate email content before encoding
    if (!emailContent || emailContent.trim().length === 0) {
      throw new Error('Email content is empty');
    }
    
    // Ensure we have proper header/body separation
    if (!emailContent.includes('\r\n\r\n')) {
      throw new Error('Email content missing header/body separator');
    }

    // Encode message using base64url encoding (RFC 4648)
    const encodedMessage = Buffer.from(emailContent, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    console.log('Email formatted:', {
      headerCount: emailLines.length - 2, // Exclude blank line and body
      bodyLength: finalMessage.length,
      encodedLength: encodedMessage.length,
      hasFrom: emailContent.includes('From:'),
      hasTo: emailContent.includes('To:'),
      hasSubject: emailContent.includes('Subject:'),
    });

    // Send reply
    try {
      console.log('Sending email with encoded message length:', encodedMessage.length);
      console.log('Email content preview (first 500 chars):', emailContent.substring(0, 500));
      
      const sendResult = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          threadId: threadId,
          raw: encodedMessage,
        },
      });
      
      console.log('Email sent successfully:', sendResult.data.id);
      return { success: true, messageId: sendResult.data.id };
    } catch (sendError) {
      const errorDetails = {
        message: sendError.message,
        code: sendError.code,
        status: sendError.response?.status,
        statusText: sendError.response?.statusText,
        data: sendError.response?.data,
        stack: sendError.stack,
      };
      console.error('Gmail API send error:', JSON.stringify(errorDetails, null, 2));
      
      // Extract more detailed error message
      let errorMessage = sendError.message;
      if (sendError.response?.data?.error) {
        errorMessage = sendError.response.data.error.message || sendError.response.data.error;
      } else if (sendError.response?.data) {
        errorMessage = JSON.stringify(sendError.response.data);
      }
      
      throw new Error(`Failed to send email: ${errorMessage}`);
    }
  } catch (error) {
    console.error('Error replying to email:', {
      message: error.message,
      stack: error.stack,
      userId,
      threadId,
    });
    throw error;
  }
};

/**
 * Reply to an email that became a task, by reading the metadata stored in its
 * description. Kept for the task-completion auto-reply path; new callers should use
 * sendThreadReply directly.
 */
export const replyToEmail = async (userId, taskId, message, polishWithAI = false, polishInstructions = '') => {
  const taskResult = await query(
    'SELECT description FROM tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );
  if (taskResult.rows.length === 0) throw new Error('Task not found');

  const metadataMatch = taskResult.rows[0].description?.match(/<!-- Email metadata: ({.*?}) -->/);
  if (!metadataMatch) throw new Error('Email metadata not found in task description');

  let meta;
  try {
    meta = JSON.parse(metadataMatch[1]);
  } catch {
    throw new Error('Invalid email metadata format');
  }

  return sendThreadReply(userId, {
    threadId: meta.threadId,
    messageId: meta.messageId,
    subject: meta.subject,
    message,
    polishWithAI,
    polishInstructions,
  });
};
