import cron from 'node-cron';
import { query } from '../config/database.js';
import {
  getCompletedToday,
  claimReportDay,
  releaseReportDay,
} from '../services/reportService.js';
import { getUserById } from '../services/userService.js';
import { sendDailyReportEmail } from '../services/emailService.js';
import { postDailySummaryToSlack } from '../services/slackService.js';
import { localDateString, localMinutesOfDay, parseTimeToMinutes, DEFAULT_TIMEZONE } from '../utils/time.js';

const SWEEP_MINUTES = 5;

/**
 * Send one user's report across their enabled channels.
 * Exported so "Send test report" in Settings runs the exact same path.
 */
export const sendReportForUser = async (userId, settings, { force = false, atMs = Date.now() } = {}) => {
  const tz = settings.timezone || DEFAULT_TIMEZONE;
  // Pick up where the last report stopped, so work done after yesterday's send is
  // carried into this one rather than falling into the gap between the two.
  //
  // atMs is the caller's send instant, not a fresh Date.now(): it must be the exact
  // value the claim writes to last_sent_at, or the sliver between the two would be
  // this window's end AND the next window's start, and land in both reports.
  //
  // `since` is skipped when forced: "Send test report" run an hour after a real one
  // would otherwise report an empty hour and look broken. A test wants to show a day.
  const report = await getCompletedToday(userId, {
    timezone: tz,
    atMs,
    since: force ? null : settings.last_sent_at ?? null,
  });

  // The gate: no commits today means no report. Commits are the trigger; the report
  // itself still covers everything completed, not just the code.
  if (!force && settings.require_commits && !report.commitDerived) {
    return { sent: false, reason: 'no_commits_today' };
  }

  if (report.items.length === 0) {
    return { sent: false, reason: 'nothing_completed' };
  }

  const results = {};

  // Each channel is isolated: SMTP being unconfigured throws, and Slack returns
  // falsy on a bad channel. Neither may take the other down.
  if (settings.email_enabled) {
    try {
      const user = await getUserById(userId);
      if (!user?.email) {
        results.email = { ok: false, error: 'no email on file' };
      } else {
        await sendDailyReportEmail(user.email, report);
        results.email = { ok: true, to: user.email };
      }
    } catch (error) {
      console.error(`Daily report: email failed for user ${userId}:`, error.message);
      results.email = { ok: false, error: error.message };
    }
  }

  if (settings.slack_enabled) {
    try {
      const slack = await postDailySummaryToSlack(
        userId,
        report.items,
        report.date,
        settings.slack_channel
      );
      results.slack = { ok: Boolean(slack?.posted), ...slack };
    } catch (error) {
      console.error(`Daily report: slack failed for user ${userId}:`, error.message);
      results.slack = { ok: false, error: error.message };
    }
  }

  const anyDelivered = Object.values(results).some((r) => r.ok);
  return { sent: anyDelivered, report: { date: report.date, ...report.counts, commitCount: report.commitCount }, results };
};

/**
 * Sweep every 5 minutes and send to whoever's local clock has reached their report
 * time.
 *
 * Deliberately a sweep rather than cron.schedule('30 16 * * *', { timezone }):
 * report time and timezone are per-user columns, so a fixed cron expression would
 * mean dynamically rescheduling jobs whenever a setting changed -- a lifecycle to get
 * wrong. This is stateless, survives restarts, and generalises to any timezone.
 */
export const startDailyReport = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await query(
        `SELECT * FROM user_report_settings
         WHERE email_enabled = true OR slack_enabled = true`
      );

      const now = Date.now();

      for (const settings of result.rows) {
        try {
          const tz = settings.timezone || DEFAULT_TIMEZONE;
          const target = parseTimeToMinutes(String(settings.report_time));
          if (target === null) continue; // don't fall back to midnight on a bad value

          const nowMinutes = localMinutesOfDay(tz, now);
          // Fire in the bucket at or just after the target, so a slightly late tick
          // still lands. Never fires twice thanks to the claim below.
          if (nowMinutes < target || nowMinutes >= target + SWEEP_MINUTES) continue;

          const today = localDateString(tz, now);
          if (settings.last_sent_on && localDateString(tz, now) === String(settings.last_sent_on).slice(0, 10)) {
            continue;
          }

          // Read before the claim overwrites it: this is the previous send time, and
          // it's the window start the report is about to be built from.
          const previousSentAt = settings.last_sent_at ?? null;

          // Claim before sending: at-most-once. A missed report beats a duplicate
          // landing in a team channel.
          const claimed = await claimReportDay(settings.user_id, today, now);
          if (!claimed) continue;

          const outcome = await sendReportForUser(settings.user_id, settings, { atMs: now });

          if (!outcome.sent) {
            // Nothing went out -- release the claim so a later tick (or tomorrow's
            // commits) can still produce a report. Restoring the old last_sent_at is
            // what makes a quiet day carry forward instead of vanish: tomorrow's
            // window then still reaches back over today's work.
            await releaseReportDay(settings.user_id, today, previousSentAt);
            if (outcome.reason !== 'no_commits_today') {
              console.log(`Daily report skipped for user ${settings.user_id}: ${outcome.reason ?? 'delivery failed'}`);
            }
          } else {
            console.log(
              `Daily report sent for user ${settings.user_id} (${outcome.report.tasks} tasks, ${outcome.report.commitCount} from commits)`
            );
          }
        } catch (error) {
          console.error(`Daily report failed for user ${settings.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Daily report job error:', error.message);
    }
  });

  console.log('Daily report job scheduled (5-minute sweep, per-user timezone and time)');
};
