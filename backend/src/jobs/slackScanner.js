import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanSlackMentions } from '../services/slackService.js';
import { sendNotification } from '../services/telegramService.js';

/**
 * Scheduled job to scan Slack mentions for all users with Slack connected.
 * Fires every minute and gates per user on their own scan_frequency.
 */

// Users with a scan currently running.
//
// node-cron does not await this callback, so a tick fires whether or not the last
// one finished. The Slack SDK auto-retries 429s honouring retry-after, so a
// rate-limited scan grinds for minutes rather than failing fast -- and every
// subsequent tick piled another concurrent scan on top, all sharing one token's
// rate-limit bucket. That is what put 20 WebClients in the logs, and it is
// self-reinforcing: more overlap -> more 429s -> slower scans -> more overlap.
const inFlight = new Set();

export const startSlackScanner = () => {
  cron.schedule('* * * * *', async () => {
    try {
      // Get all enabled Slack integrations
      const result = await query(
        `SELECT user_id, scan_frequency, last_scan_at
         FROM slack_integrations
         WHERE enabled = true`
      );

      for (const integration of result.rows) {
        const userId = integration.user_id;

        if (inFlight.has(userId)) {
          console.log(`⏭️ Slack scan already running for user ${userId}, skipping this tick`);
          continue;
        }

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

          inFlight.add(userId);
          // Renamed: this used to shadow the outer `result` holding the user list.
          const scanResult = await scanSlackMentions(userId, 50);
          console.log(`Slack mention scan completed for user ${userId}`);

          // Send Telegram notification if tasks were created
          if (scanResult && scanResult.tasksCreated > 0) {
            try {
              const taskTitles = scanResult.tasks?.map(t => `• ${t.title}`).join('\n') || '';
              const message = `✅ ${scanResult.tasksCreated} task${scanResult.tasksCreated > 1 ? 's' : ''} added to your Job list from Slack:\n${taskTitles}`;
              await sendNotification(userId, message);
            } catch (notifError) {
              console.error(`Error sending Telegram notification for user ${userId}:`, notifError);
              // Don't fail the scan if notification fails
            }
          }
        } catch (error) {
          console.error(`Error scanning Slack mentions for user ${userId}:`, error);
          // Continue with next user
        } finally {
          // finally, not after the try: a throw must release the lock or this user
          // never scans again for the life of the process.
          inFlight.delete(userId);
        }
      }
    } catch (error) {
      console.error('Slack scanner job error:', error);
    }
  });

  console.log('Slack scanner job scheduled (runs every minute, checks scan frequency per user)');
};
