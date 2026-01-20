import TelegramBot from 'node-telegram-bot-api';
import { query } from '../config/database.js';
import { parseTask } from './aiService.js';
import { createDraftTask } from './draftTaskService.js';
import { getUserTasks, syncTask, completeTask } from './taskService.js';
import crypto from 'crypto';

let bot = null;
let botInitialized = false;
let botInitializationAttempts = 0;
let handlersSetup = false;
const MAX_INIT_ATTEMPTS = 3;
// Global tracking to prevent spam across handler setups
const globalProcessedMessages = new Set();
const globalChatCooldowns = new Map();

/**
 * Initialize Telegram bot
 */
export const initializeBot = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set. Telegram bot will not be available.');
    return null;
  }

  // Prevent multiple initializations
  if (botInitialized && bot) {
    console.warn('Telegram bot already initialized, skipping re-initialization');
    return bot;
  }

  // Circuit breaker: Stop trying after too many failures
  if (botInitializationAttempts >= MAX_INIT_ATTEMPTS) {
    console.error(`❌ Telegram bot initialization failed ${MAX_INIT_ATTEMPTS} times. Disabling bot to prevent server crashes.`);
    return null;
  }

  try {
    botInitializationAttempts++;
    // Use polling for development, webhook for production
    const useWebhook = process.env.TELEGRAM_USE_WEBHOOK === 'true';
    
    if (useWebhook) {
      console.log('Initializing Telegram bot with webhook mode');
      bot = new TelegramBot(token);
      console.log('⚠️ Webhook mode: Make sure webhook is set up at /api/telegram/webhook');
      console.log('⚠️ In webhook mode, bot will NOT receive messages until webhook is configured');
    } else {
      console.log('Initializing Telegram bot with polling mode');
      bot = new TelegramBot(token, { 
        polling: {
          interval: 300,
          autoStart: true,
          params: {
            timeout: 10
          }
        }
      });
      console.log('✅ Polling started - bot will receive messages automatically');
      
      // Verify polling is active
      bot.on('polling_error', (error) => {
        console.error('❌ Polling error - bot cannot receive messages:', error.message || error);
        // Don't crash - just log
      });
      
      // Handle connection errors gracefully
      bot.on('error', (error) => {
        console.error('❌ Telegram bot connection error:', error.message || error);
        // Don't crash on errors
      });
    }

    // Verify bot is working
    bot.getMe().then((botInfo) => {
      console.log(`✅ Telegram bot started: ${botInfo.first_name} (@${botInfo.username})`);
      console.log(`   Bot ID: ${botInfo.id}`);
    }).catch((error) => {
      console.error('❌ Failed to verify Telegram bot:', error);
    });

    // Setup handlers before marking as initialized
    try {
      setupBotHandlers();
      console.log('✅ Telegram bot handlers set up');
    } catch (handlerError) {
      console.error('❌ Failed to setup bot handlers:', handlerError.message || handlerError);
      // Don't mark as initialized if handlers failed
      bot = null;
      botInitialized = false;
      return null;
    }
    
    // Mark as successfully initialized only if everything worked
    botInitialized = true;
    botInitializationAttempts = 0; // Reset on success
    
    // Test that bot can receive updates
    if (!useWebhook) {
      console.log('📡 Bot is polling for messages. Send /start to test.');
    }
    
    return bot;
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message || error);
    console.error('Error details:', error.stack);
    bot = null;
    botInitialized = false;
    handlersSetup = false; // Reset handler flag on error
    // Don't throw - let server continue
    return null;
  }
};

/**
 * Setup bot command handlers
 */
const setupBotHandlers = () => {
  if (!bot) {
    console.error('Cannot setup bot handlers: bot is null');
    return;
  }

  console.log('Setting up Telegram bot handlers...');

  // Use global tracking (defined at module level)
  const MESSAGE_COOLDOWN = 300000; // 5 minute cooldown per chat

  // /start command with aggressive spam prevention
  bot.onText(/\/start/, async (msg) => {
    if (!bot) {
      console.error('Bot is null in /start handler');
      return;
    }
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const messageKey = `${chatId}_start`;
    const uniqueKey = `${chatId}_${messageId}`; // More specific key for message tracking
    
    // CRITICAL: Mark as processed IMMEDIATELY to prevent any duplicate processing
    if (globalProcessedMessages.has(uniqueKey)) {
      console.log(`[SPAM PREVENTION] Skipping duplicate /start - already processed ${uniqueKey}`);
      return;
    }
    globalProcessedMessages.add(uniqueKey);
    
    // Check cooldown to prevent spam (5 minutes)
    const lastSent = globalChatCooldowns.get(messageKey);
    if (lastSent && Date.now() - lastSent < MESSAGE_COOLDOWN) {
      const remaining = Math.round((MESSAGE_COOLDOWN - (Date.now() - lastSent)) / 1000);
      console.log(`[SPAM PREVENTION] Skipping /start - cooldown active for chat ${chatId} (${remaining}s remaining)`);
      return; // Already marked as processed above
    }
    
    // Set cooldown IMMEDIATELY before any async operations
    globalChatCooldowns.set(messageKey, Date.now());
    
    console.log(`/start command received from user ${userId} in chat ${chatId}, message ${messageId}`);
    
    try {
      // Check if user is already linked
      const integration = await query(
        `SELECT user_id FROM telegram_integrations WHERE telegram_user_id = $1`,
        [userId]
      );

      if (integration.rows.length > 0) {
        // User is linked - DON'T send message if we just sent one (extra safety check)
        const timeSinceLastMessage = lastSent ? Date.now() - lastSent : Infinity;
        if (timeSinceLastMessage < 60000) { // 1 minute minimum between messages
          console.log(`[SPAM PREVENTION] Suppressing "Already linked" message - too soon after last message (${Math.round(timeSinceLastMessage/1000)}s ago)`);
          return;
        }
        
        // User is linked - send brief message only once
        await bot.sendMessage(
          chatId,
          `✅ Already linked! Use /help for commands.`,
          { reply_to_message_id: messageId } // Reply to the command
        );
      } else {
        // User not linked - send welcome
        await bot.sendMessage(
          chatId,
          `👋 Welcome to TaskFlow.AI!\n\n` +
          `To link your account:\n` +
          `1. Go to TaskFlow app settings\n` +
          `2. Get your linking code\n` +
          `3. Use /link <code> here\n\n` +
          `Use /help for commands.`,
          { reply_to_message_id: messageId }
        );
      }
      
      // Clean up old processed messages (keep last 2000)
      if (globalProcessedMessages.size > 2000) {
        const oldest = Array.from(globalProcessedMessages).slice(0, 1000);
        oldest.forEach(id => globalProcessedMessages.delete(id));
      }
      
      console.log(`Response sent to user ${userId}`);
    } catch (error) {
      console.error(`Error sending /start response to user ${userId}:`, error);
      // Don't remove from processed - keep it marked to prevent retry spam
    }
  });

  // /link command
  bot.onText(/\/link (.+)/, async (msg, match) => {
    if (!bot) {
      console.error('Bot is null in /link handler');
      return;
    }
    
    const chatId = msg.chat.id;
    const code = match[1];
    
    console.log(`Telegram /link command received from user ${msg.from.id}, code: ${code}`);
    
    try {
      const result = await linkTelegramAccount(msg.from, chatId, code);
      console.log(`Telegram account linked successfully for user ${result.userId}`);
      await bot.sendMessage(chatId, `✅ Successfully linked! You can now manage your tasks via Telegram.\n\nTry /help to see available commands.`);
    } catch (error) {
      console.error(`Telegram link error for user ${msg.from.id}:`, error);
      try {
        await bot.sendMessage(chatId, `❌ ${error.message}\n\nUse /help for instructions.`);
      } catch (sendError) {
        console.error('Error sending error message:', sendError);
      }
    }
  });

  // /add command - Add new task
  bot.onText(/\/add (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskText = match[1];
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return await bot.sendMessage(chatId, '❌ Please link your account first using /link <code>');
      }

      // Use AI to parse task
      const aiResult = await parseTask(taskText, 'openai');
      
      // Create task directly (or as draft based on preference)
      const taskData = {
        id: crypto.randomUUID(),
        title: aiResult?.title || taskText,
        workspace: aiResult?.workspaceSuggestions || 'personal',
        energy: aiResult?.energy || 'medium',
        status: 'todo',
        estimatedTime: aiResult?.estimatedTime || 15,
        tags: aiResult?.tags || [],
        dependencies: [],
        createdAt: Date.now(),
      };

      await syncTask(userId, taskData);
      
      await bot.sendMessage(
        chatId,
        `✅ Task added!\n\n` +
        `📝 ${taskData.title}\n` +
        `⚡ Energy: ${taskData.energy}\n` +
        `🏢 Workspace: ${taskData.workspace}\n` +
        `⏱️ Estimated: ${taskData.estimatedTime} min`
      );
    } catch (error) {
      console.error('Add task error:', error);
      await bot.sendMessage(chatId, `❌ Failed to add task: ${error.message}`);
    }
  });

  // /list command - List pending tasks
  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return await bot.sendMessage(chatId, '❌ Please link your account first using /link <code>');
      }

      const tasks = await getUserTasks(userId);
      const pendingTasks = tasks.filter(t => t.status !== 'done');
      
      if (pendingTasks.length === 0) {
        return await bot.sendMessage(chatId, '🎉 No pending tasks! You\'re all caught up.');
      }

      let message = `📋 *Your Pending Tasks* (${pendingTasks.length})\n\n`;
      pendingTasks.slice(0, 10).forEach((task, index) => {
        const energyEmoji = task.energy === 'high' ? '⚡' : task.energy === 'medium' ? '🧠' : '☕';
        message += `${index + 1}. ${energyEmoji} ${task.title}\n`;
        if (task.dueDate) {
          const dueDate = new Date(task.dueDate);
          message += `   📅 Due: ${dueDate.toLocaleDateString()}\n`;
        }
        message += `   ID: \`${task.id.substring(0, 8)}\`\n\n`;
      });

      if (pendingTasks.length > 10) {
        message += `\n... and ${pendingTasks.length - 10} more tasks`;
      }

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('List tasks error:', error);
      await bot.sendMessage(chatId, `❌ Failed to list tasks: ${error.message}`);
    }
  });

  // /today command - Show today's tasks
  bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return await bot.sendMessage(chatId, '❌ Please link your account first using /link <code>');
      }

      const tasks = await getUserTasks(userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayTasks = tasks.filter(t => {
        if (t.dueDate) {
          const dueDate = new Date(t.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          return dueDate.getTime() === today.getTime() && t.status !== 'done';
        }
        return false;
      });

      if (todayTasks.length === 0) {
        return await bot.sendMessage(chatId, '✨ No tasks due today!');
      }

      let message = `📅 *Tasks Due Today* (${todayTasks.length})\n\n`;
      todayTasks.forEach((task, index) => {
        const energyEmoji = task.energy === 'high' ? '⚡' : task.energy === 'medium' ? '🧠' : '☕';
        message += `${index + 1}. ${energyEmoji} ${task.title}\n`;
        message += `   ID: \`${task.id.substring(0, 8)}\`\n\n`;
      });

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Today tasks error:', error);
      await bot.sendMessage(chatId, `❌ Failed to get today's tasks: ${error.message}`);
    }
  });

  // /overdue command - Show overdue tasks
  bot.onText(/\/overdue/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return await bot.sendMessage(chatId, '❌ Please link your account first using /link <code>');
      }

      const tasks = await getUserTasks(userId);
      const now = Date.now();
      
      const overdueTasks = tasks.filter(t => 
        t.dueDate && t.dueDate < now && t.status !== 'done'
      );

      if (overdueTasks.length === 0) {
        return await bot.sendMessage(chatId, '✅ No overdue tasks!');
      }

      let message = `⚠️ *Overdue Tasks* (${overdueTasks.length})\n\n`;
      overdueTasks.forEach((task, index) => {
        const daysOverdue = Math.floor((now - task.dueDate) / (1000 * 60 * 60 * 24));
        message += `${index + 1}. ${task.title}\n`;
        message += `   📅 ${daysOverdue} day(s) overdue\n`;
        message += `   ID: \`${task.id.substring(0, 8)}\`\n\n`;
      });

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Overdue tasks error:', error);
      await bot.sendMessage(chatId, `❌ Failed to get overdue tasks: ${error.message}`);
    }
  });

  // /done command - Mark task as complete
  bot.onText(/\/done (.+)/, async (msg, match) => {
    if (!bot) {
      console.error('Bot is null in /done handler');
      return;
    }
    
    const chatId = msg.chat.id;
    const taskId = match[1];
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return await bot.sendMessage(chatId, '❌ Please link your account first using /link <code>');
      }

      // Find task by partial ID or full ID
      const tasks = await getUserTasks(userId);
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      
      if (!task) {
        return await bot.sendMessage(chatId, '❌ Task not found. Use /list to see your tasks.');
      }

      await completeTask(userId, task.id);
      await bot.sendMessage(chatId, `✅ Task completed: ${task.title}\n🎉 +50 XP!`);
    } catch (error) {
      console.error('Complete task error:', error);
      await bot.sendMessage(chatId, `❌ Failed to complete task: ${error.message}`);
    }
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpText = `📚 *TaskFlow.AI Bot Commands*\n\n` +
      `/start - Welcome message\n` +
      `/link <code> - Link Telegram to TaskFlow account\n` +
      `/add <task> - Add a new task\n` +
      `/list - List all pending tasks\n` +
      `/today - Show tasks due today\n` +
      `/overdue - Show overdue tasks\n` +
      `/done <task_id> - Mark task as complete\n` +
      `/help - Show this help message\n\n` +
      `*Examples:*\n` +
      `/add Fix the bug in login page\n` +
      `/done abc12345`;
    
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  });

  // DISABLED: Auto-create drafts from messages (was causing spam)
  // Users should use /add command instead
  // If you want to re-enable, uncomment and add proper cooldown/message tracking
  /*
  bot.on('message', async (msg) => {
    // Skip if it's a command
    if (msg.text && msg.text.startsWith('/')) {
      return;
    }

    // Skip if already processed
    if (globalProcessedMessages.has(msg.message_id)) {
      return;
    }

    // Skip if it's not a text message
    if (!msg.text || msg.text.trim().length === 0) {
      globalProcessedMessages.add(msg.message_id);
      return;
    }

    const chatId = msg.chat.id;
    const messageKey = `${chatId}_draft`;
    
    // Check cooldown (5 minutes)
    const lastSent = globalChatCooldowns.get(messageKey);
    if (lastSent && Date.now() - lastSent < 300000) {
      globalProcessedMessages.add(msg.message_id);
      return;
    }
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        globalProcessedMessages.add(msg.message_id);
        return;
      }

      console.log(`Creating draft task for user ${userId} from Telegram message`);
      const aiResult = await parseTask(msg.text, 'openai');
      
      const draftTask = await createDraftTask(userId, {
        source: 'telegram',
        sourceId: msg.message_id.toString(),
        title: aiResult?.title || msg.text.substring(0, 100),
        description: msg.text,
        workspace: aiResult?.workspaceSuggestions || 'personal',
        energy: aiResult?.energy || 'medium',
        estimatedTime: aiResult?.estimatedTime || 15,
        tags: aiResult?.tags || [],
        aiConfidence: 0.7,
      });

      await bot.sendMessage(
        chatId,
        `📝 Task draft created!\n\n` +
        `Title: ${draftTask.title}\n` +
        `Go to your TaskFlow app to approve or edit it.`,
        { reply_to_message_id: msg.message_id }
      );
      
      globalChatCooldowns.set(messageKey, Date.now());
      globalProcessedMessages.add(msg.message_id);
    } catch (error) {
      console.error('Message handling error:', error);
      globalProcessedMessages.add(msg.message_id);
    }
  });
  */
  
  // Mark handlers as set up (only once)
  if (!handlersSetup) {
    handlersSetup = true;
    console.log('✅ All bot handlers registered');
  } else {
    console.warn('⚠️ Handlers already set up, skipping duplicate registration');
  }
  
  // Error handler for bot (prevent crashes)
  bot.on('error', (error) => {
    console.error('Telegram bot error:', error.message || error);
    // Don't throw - just log the error
  });
  
  // Polling error handler (prevent crashes)
  bot.on('polling_error', (error) => {
    console.error('Telegram bot polling error:', error.message || error);
    // Don't throw - just log the error
    // The bot will automatically retry
  });
  
  // DISABLED: Message logging handler (was causing duplicate processing)
  // Only enable if needed for debugging
  /*
  bot.on('message', (msg) => {
    // Skip if it's a command (handled by onText handlers)
    if (msg.text && msg.text.startsWith('/')) {
      return;
    }
    
    // Only log, never respond or process
    if (msg.message_id && !globalProcessedMessages.has(msg.message_id)) {
      console.log(`📨 Telegram message received:`, {
        from: msg.from?.username || msg.from?.first_name,
        userId: msg.from?.id,
        chatId: msg.chat.id,
        text: msg.text?.substring(0, 50),
      });
      globalProcessedMessages.add(msg.message_id);
    }
  });
  */
  
  console.log('✅ All Telegram bot handlers registered');
};

/**
 * Link Telegram account to TaskFlow account
 */
export const linkTelegramAccount = async (telegramUser, chatId, code) => {
  // Code should be a verification code generated in the frontend
  // For now, we'll use a simple approach: code is the user's TaskFlow user ID
  // In production, use a more secure verification system
  
  console.log(`Linking Telegram account: telegramUserId=${telegramUser.id}, code=${code}`);
  
  const userId = parseInt(code, 10);
  
  if (isNaN(userId) || userId <= 0) {
    console.error(`Invalid linking code format: ${code}`);
    throw new Error('Invalid linking code. Please check the code from your TaskFlow app settings.');
  }

  // Verify user exists
  const userResult = await query('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    console.error(`User not found for ID: ${userId}`);
    throw new Error('Invalid linking code. User not found.');
  }
  
  console.log(`User found: ${userResult.rows[0].email}`);

  // Store or update Telegram integration
  await query(
    `INSERT INTO telegram_integrations (user_id, telegram_user_id, telegram_username, chat_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       telegram_user_id = EXCLUDED.telegram_user_id,
       telegram_username = EXCLUDED.telegram_username,
       chat_id = EXCLUDED.chat_id,
       linked_at = CURRENT_TIMESTAMP`,
    [
      userId,
      telegramUser.id,
      telegramUser.username || null,
      chatId,
    ]
  );

  // Update user's telegram_user_id (if column exists)
  // Note: This column is optional and may not exist in older schemas
  try {
    await query(
      'UPDATE users SET telegram_user_id = $1 WHERE id = $2',
      [telegramUser.id, userId]
    );
  } catch (error) {
    // Column might not exist - that's okay, we store it in telegram_integrations table
    console.log('Note: telegram_user_id column not found in users table (optional field)');
  }

  return { success: true, userId };
};

/**
 * Get user ID from Telegram user ID
 */
export const getUserIdFromTelegram = async (telegramUserId) => {
  const result = await query(
    'SELECT user_id FROM telegram_integrations WHERE telegram_user_id = $1',
    [telegramUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].user_id;
};

/**
 * Send notification to user via Telegram
 */
export const sendNotification = async (userId, message, options = {}) => {
  if (!bot) {
    console.warn('Telegram bot not initialized');
    return false;
  }

  try {
    const result = await query(
      'SELECT chat_id, notifications_enabled FROM telegram_integrations WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].notifications_enabled) {
      return false;
    }

    const chatId = result.rows[0].chat_id;
    await bot.sendMessage(chatId, message, options);
    return true;
  } catch (error) {
    console.error('Send notification error:', error);
    return false;
  }
};

/**
 * Get Telegram connection status
 */
export const getTelegramStatus = async (userId) => {
  const result = await query(
    `SELECT telegram_user_id, telegram_username, linked_at, notifications_enabled, daily_summary_time
     FROM telegram_integrations WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { connected: false };
  }

  return {
    connected: true,
    telegramUserId: result.rows[0].telegram_user_id,
    telegramUsername: result.rows[0].telegram_username,
    linkedAt: result.rows[0].linked_at,
    notificationsEnabled: result.rows[0].notifications_enabled,
    dailySummaryTime: result.rows[0].daily_summary_time,
  };
};

/**
 * Unlink Telegram account
 */
export const unlinkTelegramAccount = async (userId) => {
  await query(
    'DELETE FROM telegram_integrations WHERE user_id = $1',
    [userId]
  );

  // Update user's telegram_user_id (if column exists)
  try {
    await query(
      'UPDATE users SET telegram_user_id = NULL WHERE id = $1',
      [userId]
    );
  } catch (error) {
    // Column might not exist - that's okay
    console.log('Note: telegram_user_id column not found in users table (optional field)');
  }

  return { success: true };
};

/**
 * Update Telegram settings
 */
export const updateTelegramSettings = async (userId, settings) => {
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (settings.notificationsEnabled !== undefined) {
    updates.push(`notifications_enabled = $${paramCount++}`);
    values.push(settings.notificationsEnabled);
  }
  if (settings.dailySummaryTime !== undefined) {
    updates.push(`daily_summary_time = $${paramCount++}`);
    values.push(settings.dailySummaryTime);
  }

  if (updates.length === 0) {
    throw new Error('No settings to update');
  }

  values.push(userId);

  await query(
    `UPDATE telegram_integrations SET ${updates.join(', ')} WHERE user_id = $${paramCount++}`,
    values
  );

  return { success: true };
};

/**
 * Generate linking code for user
 */
export const generateLinkingCode = async (userId) => {
  // For simplicity, use user ID as code
  // In production, generate a secure temporary code
  return userId.toString();
};

/**
 * Get bot instance (for webhook setup)
 */
export const getBot = () => {
  return bot;
};
