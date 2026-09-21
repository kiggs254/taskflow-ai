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
      // One row per connected *account*, not per user. Each has its own installation
      // token and its own scan_frequency, so each is due independently -- scanning
      // per user would either re-scan every account whenever the earliest came due, or
      // hold all of them back to the slowest.
      const result = await query(
        `SELECT user_id, installation_id, account_login, scan_frequency, last_scan_at
         FROM github_integrations
         WHERE enabled = true AND installation_id IS NOT NULL`
      );

      for (const integration of result.rows) {
        try {
          const frequency = integration.scan_frequency || 30;

          if (integration.last_scan_at) {
            const minutesSince = (Date.now() - new Date(integration.last_scan_at).getTime()) / 60000;
            if (minutesSince < frequency) continue;
          }

          const scan = await scanCommits(integration.user_id, {
            installationId: integration.installation_id,
          });
          if (scan?.commitsIngested > 0) {
            console.log(
              `GitHub scan for user ${integration.user_id} ` +
                `(${integration.account_login ?? integration.installation_id}): ` +
                `${scan.commitsIngested} new commit(s) across ${scan.tasksCreated} task(s)`
            );
          }
        } catch (error) {
          // One account's failure must not abort the sweep.
          console.error(
            `GitHub scan failed for user ${integration.user_id} ` +
              `(${integration.account_login ?? integration.installation_id}):`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error('GitHub scanner job error:', error.message);
    }
  });

  console.log('GitHub scanner job scheduled (runs every minute, checks scan frequency per user)');
};
