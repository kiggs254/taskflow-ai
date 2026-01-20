import cron from 'node-cron';
import { query } from '../config/database.js';
import { sendNotification } from '../services/telegramService.js';

/**
 * Scheduled job to check for overdue tasks and send Telegram notifications
 * Runs every hour
 */
export const startOverdueNotifier = () => {
  // Run every hour at minute 15 (15 minutes past the hour)
  cron.schedule('15 * * * *', async () => {
    console.log('Checking for overdue tasks...');
    
    try {
      const now = Date.now();
      
      // Get all users with Telegram connected and notifications enabled
      const usersResult = await query(
        `SELECT DISTINCT t.user_id
         FROM telegram_integrations t
         WHERE t.notifications_enabled = true`
      );

      for (const userRow of usersResult.rows) {
        try {
          const userId = userRow.user_id;
          
          // Get overdue tasks for this user
          const tasksResult = await query(
            `SELECT id, title, due_date, workspace, energy
             FROM tasks
             WHERE user_id = $1
               AND status != 'done'
               AND due_date IS NOT NULL
               AND due_date < $2
             ORDER BY due_date ASC
             LIMIT 10`,
            [userId, now]
          );

          if (tasksResult.rows.length === 0) {
            continue; // No overdue tasks
          }

          const overdueTasks = tasksResult.rows;
          
          // Format message
          let message = `⚠️ *You have ${overdueTasks.length} overdue task(s)*\n\n`;
          
          overdueTasks.forEach((task, index) => {
            const daysOverdue = Math.floor((now - task.due_date) / (1000 * 60 * 60 * 24));
            const energyEmoji = task.energy === 'high' ? '⚡' : task.energy === 'medium' ? '🧠' : '☕';
            
            message += `${index + 1}. ${energyEmoji} *${task.title}*\n`;
            message += `   📅 ${daysOverdue} day(s) overdue\n`;
            message += `   ID: \`${task.id.substring(0, 8)}\`\n\n`;
          });

          message += `Use /done <task_id> to mark as complete`;

          // Send notification
          await sendNotification(userId, message, { parse_mode: 'Markdown' });
          console.log(`Overdue notification sent to user ${userId}`);
        } catch (error) {
          console.error(`Error sending overdue notification to user ${userRow.user_id}:`, error);
          // Continue with next user
        }
      }
    } catch (error) {
      console.error('Overdue notifier job error:', error);
    }
  });

  console.log('Overdue notifier job scheduled (runs every hour at :15)');
};

/**
 * Daily summary job - send daily task summary to users
 * Runs once per day at configured time
 */
export const startDailySummary = () => {
  // Run every day at 9:00 AM (can be customized per user)
  cron.schedule('0 9 * * *', async () => {
    console.log('Sending daily summaries...');
    
    try {
      // Get all users with Telegram connected
      const usersResult = await query(
        `SELECT t.user_id, t.daily_summary_time, t.chat_id
         FROM telegram_integrations t
         WHERE t.notifications_enabled = true`
      );

      for (const userRow of usersResult.rows) {
        try {
          const userId = userRow.user_id;
          const summaryTime = userRow.daily_summary_time || '09:00';
          
          // Get today's tasks
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          const tasksResult = await query(
            `SELECT id, title, workspace, energy, status, due_date
             FROM tasks
             WHERE user_id = $1
               AND status != 'done'
               AND (due_date IS NULL OR (due_date >= $2 AND due_date < $3))
             ORDER BY due_date ASC NULLS LAST
             LIMIT 10`,
            [userId, today.getTime(), tomorrow.getTime()]
          );

          const tasks = tasksResult.rows;
          const completedTodayResult = await query(
            `SELECT COUNT(*) as count
             FROM tasks
             WHERE user_id = $1
               AND status = 'done'
               AND completed_at >= $2`,
            [userId, today.getTime()]
          );
          
          const completedToday = parseInt(completedTodayResult.rows[0].count, 10);

          // Format summary message
          let message = `📊 *Daily Task Summary*\n\n`;
          message += `✅ Completed today: ${completedToday}\n`;
          message += `📋 Pending: ${tasks.length}\n\n`;
          
          if (tasks.length > 0) {
            message += `*Today's Tasks:*\n`;
            tasks.slice(0, 5).forEach((task, index) => {
              const energyEmoji = task.energy === 'high' ? '⚡' : task.energy === 'medium' ? '🧠' : '☕';
              message += `${index + 1}. ${energyEmoji} ${task.title}\n`;
            });
            if (tasks.length > 5) {
              message += `\n... and ${tasks.length - 5} more`;
            }
          } else {
            message += `✨ No tasks for today!`;
          }

          // Send notification
          await sendNotification(userId, message, { parse_mode: 'Markdown' });
          console.log(`Daily summary sent to user ${userId}`);
        } catch (error) {
          console.error(`Error sending daily summary to user ${userRow.user_id}:`, error);
          // Continue with next user
        }
      }
    } catch (error) {
      console.error('Daily summary job error:', error);
    }
  });

  console.log('Daily summary job scheduled (runs daily at 9:00 AM)');
};
