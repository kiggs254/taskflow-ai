import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanEmails } from '../services/gmailService.js';

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
          await scanEmails(integration.user_id, 50);
          console.log(`Email scan completed for user ${integration.user_id}`);
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
