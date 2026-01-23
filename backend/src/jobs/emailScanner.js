import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanEmails } from '../services/gmailService.js';
import { sendNotification } from '../services/telegramService.js';

/**
 * Scheduled job to scan emails for all users with Gmail connected
 * Runs every minute to check if it's time for each user based on their scan_frequency
 */
export const startEmailScanner = () => {
  // Run every minute to check scan frequency for each user
  cron.schedule('* * * * *', async () => {
    try {
      // Get all enabled Gmail integrations
      const result = await query(
        `SELECT user_id, scan_frequency, last_scan_at
         FROM gmail_integrations
         WHERE enabled = true`
      );

      if (result.rows.length === 0) {
        // No enabled Gmail integrations, skip silently
        return;
      }

      for (const integration of result.rows) {
        try {
          const lastScanAt = integration.last_scan_at;
          const scanFrequency = integration.scan_frequency || 15; // minutes, default 15
          
          // Check if it's time to scan
          if (lastScanAt) {
            const lastScan = new Date(lastScanAt);
            const now = new Date();
            const minutesSinceLastScan = (now - lastScan) / (1000 * 60);
            
            if (minutesSinceLastScan < scanFrequency) {
              // Not time to scan yet - log only occasionally to reduce noise
              continue;
            }
            console.log(`📧 Gmail scan triggered for user ${integration.user_id} (${minutesSinceLastScan.toFixed(1)} min since last scan, frequency: ${scanFrequency} min)`);
          } else {
            console.log(`📧 Gmail scan triggered for user ${integration.user_id} (first scan)`);
          }

          // Scan emails for this user
          const scanResult = await scanEmails(integration.user_id, 50);
          console.log(`📧 Gmail scan completed for user ${integration.user_id}: ${scanResult?.draftsCreated || 0} drafts, ${scanResult?.tasksCreated || 0} tasks`);
          
          // Send Telegram notification if tasks were created
          if (scanResult && (scanResult.draftsCreated > 0 || scanResult.tasksCreated > 0)) {
            try {
              let message = '';
              const taskTitles = scanResult.tasks?.map(t => `• ${t.title}`).join('\n') || '';
              const draftTitles = scanResult.drafts?.map(d => `• ${d.title}`).join('\n') || '';
              
              if (scanResult.tasksCreated > 0 && scanResult.draftsCreated > 0) {
                message = `✅ ${scanResult.tasksCreated} task${scanResult.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}\n\n📝 ${scanResult.draftsCreated} draft task${scanResult.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
              } else if (scanResult.tasksCreated > 0) {
                message = `✅ ${scanResult.tasksCreated} task${scanResult.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}`;
              } else if (scanResult.draftsCreated > 0) {
                message = `📝 ${scanResult.draftsCreated} draft task${scanResult.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
              }
              
              if (message) {
                await sendNotification(integration.user_id, message);
              }
            } catch (notifError) {
              console.error(`Error sending Telegram notification for user ${integration.user_id}:`, notifError);
              // Don't fail the scan if notification fails
            }
          }
        } catch (error) {
          console.error(`Error scanning emails for user ${integration.user_id}:`, error);
          // Continue with next user
        }
      }
    } catch (error) {
      console.error('Email scanner job error:', error);
    }
  });

  console.log('Email scanner job scheduled (runs every minute, checks scan frequency per user)');
};
