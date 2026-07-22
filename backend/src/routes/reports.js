import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getCompletedToday, attachNarratives, getReportSettings, updateReportSettings } from '../services/reportService.js';
import { sendReportForUser } from '../jobs/dailyReport.js';

const router = express.Router();
router.use(authenticate);

const toClient = (s) => ({
  timezone: s.timezone,
  reportTime: String(s.report_time).slice(0, 5),
  emailEnabled: s.email_enabled,
  slackEnabled: s.slack_enabled,
  slackChannel: s.slack_channel,
  requireCommits: s.require_commits,
  lastSentOn: s.last_sent_on,
});

/**
 * GET /api/reports/completed-today?tz=
 * The frontend calls this instead of recomputing "completed today" locally, so the
 * in-app view and the 16:30 job can't disagree.
 */
router.get('/completed-today', asyncHandler(async (req, res) => {
  // Built from the same window the job will use, including the carry-forward from the
  // last send -- its only caller is the report preview in Settings, and a preview that
  // doesn't match what gets sent is worse than no preview.
  const settings = await getReportSettings(req.user.id);
  const report = await getCompletedToday(req.user.id, {
    timezone: req.query.tz || settings.timezone,
    since: settings.last_sent_at ?? null,
  });
  // Same narratives the real send renders, so the preview is faithful.
  await attachNarratives(report, req.user.id);
  res.json(report);
}));

router.get('/settings', asyncHandler(async (req, res) => {
  res.json(toClient(await getReportSettings(req.user.id)));
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const { timezone, reportTime, emailEnabled, slackEnabled, slackChannel, requireCommits } = req.body;
  const updated = await updateReportSettings(req.user.id, {
    timezone,
    report_time: reportTime,
    email_enabled: emailEnabled,
    slack_enabled: slackEnabled,
    slack_channel: slackChannel,
    require_commits: requireCommits,
  });
  res.json(toClient(updated));
}));

/**
 * POST /api/reports/send-now
 * Runs the real delivery path on demand. Without this the feedback loop on a
 * 16:30-only job is a full day, which makes the email template untestable.
 * `force` bypasses the commit gate so the plumbing can be checked on a quiet day.
 */
router.post('/send-now', asyncHandler(async (req, res) => {
  const settings = await getReportSettings(req.user.id);
  const outcome = await sendReportForUser(req.user.id, settings, { force: req.body?.force !== false });
  res.json(outcome);
}));

export default router;
