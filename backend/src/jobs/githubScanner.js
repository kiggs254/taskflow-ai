import cron from 'node-cron';
import { query } from '../config/database.js';
import { scanCommits } from '../services/githubService.js';
import { isGithubConfigured } from '../services/githubAuth.js';

/**
 * Scan GitHub for new commits. Mirrors emailScanner: fires every minute and gates
 * per user on their own scan_frequency, so frequency is a DB value rather than a
 * redeploy.
 */
export const startGithubScanner = () => {
  if (!isGithubConfigured()) {
    console.log('GitHub scanner not started (GITHUB_APP_* not configured)');
    return;
  }

  cron.schedule('* * * * *', async () => {
    try {
      const result = await query(
        `SELECT user_id, scan_frequency, last_scan_at
         FROM github_integrations
         WHERE enabled = true`
      );

      for (const integration of result.rows) {
        try {
          const frequency = integration.scan_frequency || 30;

          if (integration.last_scan_at) {
            const minutesSince = (Date.now() - new Date(integration.last_scan_at).getTime()) / 60000;
            if (minutesSince < frequency) continue;
          }

          const scan = await scanCommits(integration.user_id);
          if (scan?.commitsIngested > 0) {
            console.log(
              `GitHub scan for user ${integration.user_id}: ` +
                `${scan.commitsIngested} new commit(s) across ${scan.tasksCreated} task(s)`
            );
          }
        } catch (error) {
          // One user's failure must not abort the sweep.
          console.error(`GitHub scan failed for user ${integration.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('GitHub scanner job error:', error.message);
    }
  });

  console.log('GitHub scanner job scheduled (runs every minute, checks scan frequency per user)');
};
