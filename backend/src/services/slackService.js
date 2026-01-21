import { WebClient } from '@slack/web-api';
import { query } from '../config/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { parseTask } from './aiService.js';
import { syncTask } from './taskService.js';
import crypto from 'crypto';

/**
 * Get user ID from Slack user ID
 */
const getUserIdFromSlack = async (slackUserId) => {
  const result = await query(
    'SELECT user_id FROM slack_integrations WHERE slack_user_id = $1',
    [slackUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].user_id;
};

/**
 * Generate Slack OAuth authorization URL
 */
export const getAuthUrl = (userId) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI || `${process.env.FRONTEND_URL}/api/slack/callback`;
  
  if (!clientId) {
    throw new Error('Slack OAuth credentials not configured');
  }

  const scopes = [
    'app_mentions:read',      // Read mentions of the app
    'channels:read',          // List public channels (required for conversations.list)
    'channels:history',       // Read channel messages
    'groups:read',            // List private channels (required for conversations.list)
    'groups:history',         // Read private channel messages
    'im:history',             // Read direct messages
    'users:read',             // Read user info
    'chat:write',             // Post messages as the app (daily summaries, notifications)
  ].join(',');

  const state = userId.toString();
  const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  
  return url;
};

/**
 * Handle Slack OAuth callback and store tokens
 */
export const handleOAuthCallback = async (code, userId) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI || `${process.env.FRONTEND_URL}/api/slack/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('Slack OAuth credentials not configured');
  }

  try {
    console.log('Exchanging Slack authorization code for tokens...');
    
    // Exchange code for access token
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Failed to get Slack access token');
    }

    const accessToken = data.access_token;
    const teamId = data.team.id;
    const teamName = data.team.name;
    const authedUser = data.authed_user;
    const slackUserId = authedUser.id;

    console.log('Slack tokens received, user:', slackUserId, 'team:', teamName);

    // Encrypt token
    const encryptedAccessToken = encrypt(accessToken);
    
    if (!encryptedAccessToken) {
      throw new Error('Failed to encrypt token');
    }

    // Calculate token expiration (Slack tokens don't expire, but we'll set a far future date)
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    // Store or update integration
    await query(
      `INSERT INTO slack_integrations (user_id, slack_user_id, slack_team_id, access_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         slack_user_id = EXCLUDED.slack_user_id,
         slack_team_id = EXCLUDED.slack_team_id,
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         enabled = true`,
      [userId, slackUserId, teamId, encryptedAccessToken, expiresAt]
    );

    console.log('Slack integration stored successfully');
    return { success: true, teamName, slackUserId };
  } catch (error) {
    console.error('Slack OAuth callback error:', error);
    throw new Error(`Failed to connect Slack: ${error.message}`);
  }
};

/**
 * Get Slack client for a user
 */
const getSlackClient = async (userId) => {
  const result = await query(
    'SELECT slack_user_id, slack_team_id, access_token FROM slack_integrations WHERE user_id = $1 AND enabled = true',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Slack not connected');
  }

  const integration = result.rows[0];
  const accessToken = decrypt(integration.access_token);

  return new WebClient(accessToken);
};

/**
 * Scan Slack for mentions and extract tasks
 */
export const scanSlackMentions = async (userId, maxMentions = 50) => {
  try {
    const client = await getSlackClient(userId);
    
    // Get integration settings
    const integrationResult = await query(
      'SELECT last_scan_at, slack_user_id FROM slack_integrations WHERE user_id = $1',
      [userId]
    );
    
    const lastScanAt = integrationResult.rows[0]?.last_scan_at;
    const slackUserId = integrationResult.rows[0]?.slack_user_id;
    
    // Get user's Slack user ID to search for mentions
    const userMention = `<@${slackUserId}>`;
    
    let oldestTimestamp = null;
    if (lastScanAt) {
      oldestTimestamp = Math.floor(new Date(lastScanAt).getTime() / 1000); // Slack uses Unix timestamp in seconds
    }

    const createdTasks = [];
    let processedCount = 0;

    // Get list of channels the user is a member of
    const channelsResponse = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
    });

    if (!channelsResponse.ok) {
      const errorMsg = channelsResponse.error || 'Unknown error';
      if (errorMsg === 'missing_scope') {
        throw new Error('Missing required Slack permissions. Please disconnect and reconnect Slack with updated permissions.');
      }
      throw new Error(`Failed to get Slack channels: ${errorMsg}`);
    }

    const channels = channelsResponse.channels || [];

    // Check each channel for mentions
    for (const channel of channels) {
      if (processedCount >= maxMentions) break;

      try {
        // Get messages from this channel
        const historyParams = {
          channel: channel.id,
          limit: 100,
        };

        if (oldestTimestamp) {
          historyParams.oldest = oldestTimestamp.toString();
        }

        const historyResponse = await client.conversations.history(historyParams);

        if (!historyResponse.ok) {
          const errorMsg = historyResponse.error || 'Unknown error';
          // Skip channels where bot is not a member (this is normal)
          if (errorMsg === 'not_in_channel') {
            // Silently skip - bot is not in this channel
            continue;
          }
          if (errorMsg === 'missing_scope') {
            console.error(`Missing scope for channel ${channel.name}: ${errorMsg}`);
          }
          continue;
        }

        if (!historyResponse.messages) {
          continue;
        }

        // Filter messages that mention the user
        const mentionedMessages = historyResponse.messages.filter(msg => 
          msg.text && msg.text.includes(userMention)
        );

        for (const message of mentionedMessages) {
          if (processedCount >= maxMentions) break;

          try {
            // Skip if we've already processed this message
            const messageTimestamp = parseFloat(message.ts) * 1000;
            if (lastScanAt && messageTimestamp <= new Date(lastScanAt).getTime()) {
              continue;
            }

            const messageText = message.text || '';
            const channelName = channel.name || 'unknown';
            
            // Get permalink for the message
            let permalink = '';
            try {
              const permalinkResponse = await client.chat.getPermalink({
                channel: channel.id,
                message_ts: message.ts,
              });
              if (permalinkResponse.ok) {
                permalink = permalinkResponse.permalink || '';
              }
            } catch (e) {
              // Permalink might fail, continue anyway
            }
            
            // Use AI to determine if this is a task
            const aiResult = await parseTask(messageText, 'openai');
            
            if (aiResult && aiResult.title) {
              // Create approved task directly (no draft step)
              const newTask = {
                id: crypto.randomUUID(),
                title: aiResult.title,
                description: `From Slack #${channelName}\n\n${messageText}${permalink ? `\n\nLink: ${permalink}` : ''}`,
                workspace: 'job', // All Slack tasks go to Job workspace
                energy: aiResult.energy || 'medium',
                estimatedTime: aiResult.estimatedTime || 15,
                tags: [...(aiResult.tags || []), 'slack', channelName],
                status: 'todo',
                dependencies: [],
                createdAt: Date.now(),
              };

              await syncTask(userId, newTask);
              createdTasks.push(newTask);
              processedCount++;
            }
          } catch (error) {
            console.error(`Error processing Slack message ${message.ts}:`, error);
            // Continue with next message
          }
        }
      } catch (error) {
        // Handle specific Slack API errors gracefully
        if (error.code === 'slack_webapi_platform_error' && error.data?.error === 'not_in_channel') {
          // Bot is not in this channel - skip silently (this is normal)
          continue;
        }
        // Log other errors
        console.error(`Error processing channel ${channel.name}:`, error.message || error);
        // Continue with next channel
      }
    }

    // Update last_scan_at
    await query(
      'UPDATE slack_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );

    return { success: true, tasksCreated: createdTasks.length, tasks: createdTasks };
  } catch (error) {
    console.error('Slack mention scanning error:', error);
    
    // Provide user-friendly error messages for common issues
    if (error.message && error.message.includes('missing_scope')) {
      throw new Error('Missing required Slack permissions. Please disconnect and reconnect Slack to grant updated permissions.');
    }
    
    if (error.message && error.message.includes('not_authed')) {
      throw new Error('Slack authentication expired. Please disconnect and reconnect Slack.');
    }
    
    throw error;
  }
};

/**
 * Send notification to user via Slack DM
 */
export const sendSlackNotification = async (userId, message, options = {}) => {
  try {
    const result = await query(
      'SELECT slack_user_id, notifications_enabled FROM slack_integrations WHERE user_id = $1 AND enabled = true',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].notifications_enabled) {
      return false;
    }

    const client = await getSlackClient(userId);
    const slackUserId = result.rows[0].slack_user_id;

    // Open or get DM channel with user
    const dmResponse = await client.conversations.open({
      users: slackUserId,
    });

    if (!dmResponse.ok || !dmResponse.channel) {
      console.error('Failed to open Slack DM channel');
      return false;
    }

    await client.chat.postMessage({
      channel: dmResponse.channel.id,
      text: message,
      ...options,
    });

    return true;
  } catch (error) {
    console.error('Send Slack notification error:', error);
    return false;
  }
};

/**
 * Get Slack connection status
 */
export const getSlackStatus = async (userId) => {
  let result;
  try {
    result = await query(
      `SELECT slack_user_id, slack_team_id, enabled, last_scan_at, scan_frequency, notifications_enabled, created_at
       FROM slack_integrations WHERE user_id = $1`,
      [userId]
    );
  } catch (error) {
    // Backwards compatibility if notifications_enabled column doesn't exist yet
    if (error?.code === '42703') {
      result = await query(
        `SELECT slack_user_id, slack_team_id, enabled, last_scan_at, scan_frequency, created_at
         FROM slack_integrations WHERE user_id = $1`,
        [userId]
      );
      result.rows = result.rows.map((row) => ({ ...row, notifications_enabled: true }));
    } else {
      throw error;
    }
  }

  if (result.rows.length === 0) {
    return { connected: false };
  }

  return {
    connected: true,
    slackUserId: result.rows[0].slack_user_id,
    slackTeamId: result.rows[0].slack_team_id,
    enabled: result.rows[0].enabled,
    lastScanAt: result.rows[0].last_scan_at,
    scanFrequency: result.rows[0].scan_frequency,
    notificationsEnabled: result.rows[0].notifications_enabled !== false, // Default to true if null
    createdAt: result.rows[0].created_at,
  };
};

/**
 * Disconnect Slack
 */
export const disconnectSlack = async (userId) => {
  await query(
    'DELETE FROM slack_integrations WHERE user_id = $1',
    [userId]
  );

  return { success: true };
};

/**
 * Update Slack settings
 */
export const updateSlackSettings = async (userId, settings) => {
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
  if (settings.notificationsEnabled !== undefined) {
    updates.push(`notifications_enabled = $${paramCount++}`);
    values.push(settings.notificationsEnabled);
  }

  if (updates.length === 0) {
    throw new Error('No settings to update');
  }

  values.push(userId);

  await query(
    `UPDATE slack_integrations SET ${updates.join(', ')} WHERE user_id = $${paramCount++}`,
    values
  );

  return { success: true };
};

/**
 * Post a daily summary of completed tasks to a Slack channel.
 * Targets #tech-team-daily-tasks in the user's workspace.
 */
export const postDailySummaryToSlack = async (userId, tasks = [], dateLabel) => {
  if (!tasks || tasks.length === 0) {
    return { success: true, posted: false, reason: 'no_tasks' };
  }

  try {
    const client = await getSlackClient(userId);

    // Find the #tech-team-daily-tasks channel
    const channelsResponse = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
    });

    if (!channelsResponse.ok || !channelsResponse.channels) {
      throw new Error('Failed to list Slack channels');
    }

    const channel = channelsResponse.channels.find((ch) => ch.name === 'tech-team-daily-tasks');

    if (!channel) {
      throw new Error('Slack channel #tech-team-daily-tasks not found or app not invited');
    }

    const dateText = dateLabel || new Date().toLocaleDateString();

    const lines = tasks.map((t, index) => {
      // No workspace tag, just a clean numbered list of titles
      return `${index + 1}. ${t.title}`;
    });

    const text = `*Newtons Tasks - ${dateText}*\n${lines.join('\n')}`;

    await client.chat.postMessage({
      channel: channel.id,
      text,
      mrkdwn: true,
    });

    return { success: true, posted: true };
  } catch (error) {
    console.error('Slack daily summary error:', error);
    throw error;
  }
};

/**
 * Handle Slack Events API webhook
 * Processes events like message events in DMs
 */
export const handleSlackEvent = async (event) => {
  try {
    // Handle URL verification challenge
    if (event.type === 'url_verification') {
      return { challenge: event.challenge };
    }

    // Handle event callbacks
    if (event.type === 'event_callback') {
      const eventData = event.event;

      // Only process message events in DMs (im channel type)
      if (eventData.type === 'message' && eventData.channel_type === 'im' && !eventData.bot_id) {
        const slackUserId = eventData.user;
        const messageText = eventData.text || '';

        // Check if it's a command
        if (messageText.startsWith('/add ')) {
          const taskText = messageText.substring(5).trim();

          const userId = await getUserIdFromSlack(slackUserId);
          if (!userId) {
            // User not linked - we can't send a message without their access token
            // They need to link their account first in the app
            console.log(`Slack user ${slackUserId} tried to use /add but account is not linked`);
            return { success: true };
          }

          if (!taskText) {
            // Send error message back
            await sendSlackNotification(userId, '❌ Please provide a task description. Example: /add Fix the bug');
            return { success: true };
          }

          try {
            // Use AI to parse task
            const aiResult = await parseTask(taskText, 'openai');

            // Create a fully approved task directly (no draft step)
            const title = aiResult?.title || taskText.split('\n')[0].substring(0, 100) || taskText.substring(0, 100);
            const newTask = {
              id: crypto.randomUUID(),
              title,
              description: taskText,
              workspace: 'job', // All Slack tasks go to Job workspace
              energy: aiResult?.energy || 'medium',
              estimatedTime: aiResult?.estimatedTime || 15,
              tags: [...(aiResult?.tags || []), 'slack'],
              status: 'todo',
              dependencies: [],
              createdAt: Date.now(),
            };

            await syncTask(userId, newTask);

            // Send confirmation message
            await sendSlackNotification(
              userId,
              `✅ Task created in your Job list!\n\n` +
              `📋 ${newTask.title}\n` +
              `⚡ Energy: ${newTask.energy}\n` +
              `🏢 Workspace: Job\n` +
              `⏱️ Estimated: ${newTask.estimatedTime} min`
            );
          } catch (error) {
            console.error('Slack /add command error:', error);
            await sendSlackNotification(userId, `❌ Failed to add task: ${error.message}`);
          }
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Slack event handling error:', error);
    throw error;
  }
};
