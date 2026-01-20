import TelegramBot from 'node-telegram-bot-api';
import { query } from '../config/database.js';
import { parseTask } from './aiService.js';
import { createDraftTask } from './draftTaskService.js';
import { getUserTasks, syncTask, completeTask } from './taskService.js';
import crypto from 'crypto';

let bot = null;

/**
 * Initialize Telegram bot
 */
export const initializeBot = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set. Telegram bot will not be available.');
    return null;
  }

  try {
    // Use polling for development, webhook for production
    const useWebhook = process.env.TELEGRAM_USE_WEBHOOK === 'true';
    
    if (useWebhook) {
      bot = new TelegramBot(token);
    } else {
      bot = new TelegramBot(token, { polling: true });
    }

    setupBotHandlers();
    console.log('Telegram bot initialized');
    return bot;
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error);
    return null;
  }
};

/**
 * Setup bot command handlers
 */
const setupBotHandlers = () => {
  if (!bot) return;

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await bot.sendMessage(
      chatId,
      `👋 Welcome to TaskFlow.AI!\n\n` +
      `To get started, link your Telegram account to your TaskFlow account.\n\n` +
      `1. Go to your TaskFlow app settings\n` +
      `2. Find the Telegram integration section\n` +
      `3. Copy the linking code\n` +
      `4. Use /link <code> to connect\n\n` +
      `Use /help to see all commands.`
    );
  });

  // /link command
  bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1];
    
    try {
      const result = await linkTelegramAccount(msg.from, chatId, code);
      await bot.sendMessage(chatId, `✅ Successfully linked! You can now manage your tasks via Telegram.`);
    } catch (error) {
      await bot.sendMessage(chatId, `❌ ${error.message}\n\nUse /help for instructions.`);
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

  // Handle any other message as potential task
  bot.on('message', async (msg) => {
    // Skip if it's a command
    if (msg.text && msg.text.startsWith('/')) {
      return;
    }

    const chatId = msg.chat.id;
    
    try {
      const userId = await getUserIdFromTelegram(msg.from.id);
      if (!userId) {
        return; // User not linked, ignore
      }

      // Create draft task from message
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
        `Go to your TaskFlow app to approve or edit it.`
      );
    } catch (error) {
      // Silently fail for unlinked users or errors
      console.error('Message handling error:', error);
    }
  });
};

/**
 * Link Telegram account to TaskFlow account
 */
export const linkTelegramAccount = async (telegramUser, chatId, code) => {
  // Code should be a verification code generated in the frontend
  // For now, we'll use a simple approach: code is the user's TaskFlow user ID
  // In production, use a more secure verification system
  
  const userId = parseInt(code, 10);
  
  if (isNaN(userId)) {
    throw new Error('Invalid linking code');
  }

  // Verify user exists
  const userResult = await query('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    throw new Error('Invalid linking code');
  }

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

  // Update user's telegram_user_id
  await query(
    'UPDATE users SET telegram_user_id = $1 WHERE id = $2',
    [telegramUser.id, userId]
  );

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

  await query(
    'UPDATE users SET telegram_user_id = NULL WHERE id = $1',
    [userId]
  );

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
