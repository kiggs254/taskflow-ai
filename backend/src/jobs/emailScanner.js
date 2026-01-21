import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanEmails } from '../services/gmailService.js';
import { sendNotification } from '../services/telegramService.js';

/**
 * Scheduled job to scan emails for all users with Gmail connected
 * Runs every hour by default
 */
export const startEmailScanner = () => {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log('Running scheduled email scan...');
    
    try {
      // Get all enabled Gmail integrations
      const result = await query(
        `SELECT user_id, scan_frequency, last_scan_at
         FROM gmail_integrations
         WHERE enabled = true`
      );

      for (const integration of result.rows) {
        try {
          const lastScanAt = integration.last_scan_at;
          const scanFrequency = integration.scan_frequency || 60; // minutes
          
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

          // Scan emails for this user
          const result = await scanEmails(integration.user_id, 50);
          console.log(`Email scan completed for user ${integration.user_id}`);
          
          // Send Telegram notification if tasks were created
          if (result && (result.draftsCreated > 0 || result.tasksCreated > 0)) {
            try {
              let message = '';
              const taskTitles = result.tasks?.map(t => `• ${t.title}`).join('\n') || '';
              const draftTitles = result.drafts?.map(d => `• ${d.title}`).join('\n') || '';
              
              if (result.tasksCreated > 0 && result.draftsCreated > 0) {
                message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}\n\n📝 ${result.draftsCreated} draft task${result.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
              } else if (result.tasksCreated > 0) {
                message = `✅ ${result.tasksCreated} task${result.tasksCreated > 1 ? 's' : ''} added to your Job list from Gmail:\n${taskTitles}`;
              } else if (result.draftsCreated > 0) {
                message = `📝 ${result.draftsCreated} draft task${result.draftsCreated > 1 ? 's' : ''} created from Gmail:\n${draftTitles}`;
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

  console.log('Email scanner job scheduled (runs every hour)');
};
