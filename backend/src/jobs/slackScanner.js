import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanSlackMentions } from '../services/slackService.js';
import { sendNotification } from '../services/telegramService.js';

/**
 * Scheduled job to scan Slack mentions for all users with Slack connected
 * Runs every 15 minutes by default (more frequent than email since mentions are time-sensitive)
 */
export const startSlackScanner = () => {
  // Run every minute to check scan frequency for each user
  cron.schedule('* * * * *', async () => {
    try {
      // Get all enabled Slack integrations
      const result = await query(
        `SELECT user_id, scan_frequency, last_scan_at
         FROM slack_integrations
         WHERE enabled = true`
      );

      for (const integration of result.rows) {
        try {
          const lastScanAt = integration.last_scan_at;
          const scanFrequency = integration.scan_frequency || 15; // minutes
          
          // Check if it's time to scan
          if (lastScanAt) {
            const lastScan = new Date(lastScanAt);
            const now = new Date();
            const minutesSinceLastScan = (now - lastScan) / (1000 * 60);
            
            if (minutesSinceLastScan < scanFrequency) {
              // Not time to scan yet
              continue;
            }
          }

          // Scan mentions for this user
          const result = await scanSlackMentions(integration.user_id, 50);
          console.log(`Slack mention scan completed for user ${integration.user_id}`);
          
          // Send Telegram notification if tasks were created
          if (result && result.tasksCreated > 0) {
            try {
              const taskTitles = result.tasks?.map(t => `• ${t.title}`).join('\n') || '';
              const message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Slack:\n${taskTitles}`;
              await sendNotification(integration.user_id, message);
            } catch (notifError) {
              console.error(`Error sending Telegram notification for user ${integration.user_id}:`, notifError);
              // Don't fail the scan if notification fails
            }
          }
        } catch (error) {
          console.error(`Error scanning Slack mentions for user ${integration.user_id}:`, error);
          // Continue with next user
        }
      }
    } catch (error) {
      console.error('Slack scanner job error:', error);
    }
  });

  console.log('Slack scanner job scheduled (runs every minute, checks scan frequency per user)');
};
