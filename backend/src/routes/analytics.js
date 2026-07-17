import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { query } from '../config/database.js';
import { getAnalyticsSummary, getStreaks } from '../services/analyticsService.js';
import { callAI } from '../services/ai/callAI.js';
import { DEFAULT_TIMEZONE, localDateString } from '../utils/time.js';

const router = express.Router();
router.use(authenticate);

router.get('/summary', asyncHandler(async (req, res) => {
  const { range = '30d', tz = DEFAULT_TIMEZONE } = req.query;
  const [summary, streaks] = await Promise.all([
    getAnalyticsSummary(req.user.id, { range, timezone: tz }),
    getStreaks(req.user.id, tz),
  ]);
  res.json({ ...summary, streaks });
}));

const NARRATIVE_SCHEMA = {
  name: 'analytics_narrative',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'insights', 'recommendation'],
    properties: {
      headline: { type: 'string', description: 'One sentence summarising the period.' },
      insights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail', 'sentiment'],
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          },
        },
      },
      recommendation: { type: 'string', description: 'One concrete, actionable suggestion.' },
    },
  },
};

/**
 * GET /api/analytics/narrative
 *
 * Cached per user per local day: without the cache every visit to the Analytics tab
 * is a smart-tier model call, which is a cost bug with a long fuse.
 *
 * Only aggregates are sent to the model, never raw task titles -- cheaper, and the
 * analytics feature has no business shipping the user's task text to a third party.
 */
router.get('/narrative', asyncHandler(async (req, res) => {
  const { range = '30d', tz = DEFAULT_TIMEZONE } = req.query;
  const day = localDateString(tz);
  const cacheKey = `${range}:${day}`;

  const cached = await query(
    'SELECT payload FROM analytics_narrative WHERE user_id = $1 AND cache_key = $2',
    [req.user.id, cacheKey]
  );
  if (cached.rows[0]) return res.json({ ...cached.rows[0].payload, cached: true });

  const [summary, streaks] = await Promise.all([
    getAnalyticsSummary(req.user.id, { range, timezone: tz }),
    getStreaks(req.user.id, tz),
  ]);

  if (summary.headline.completed === 0) {
    return res.json({
      headline: 'No completed tasks in this period yet.',
      insights: [],
      recommendation: 'Complete a task to start building a picture of your patterns.',
    });
  }

  const facts = {
    range,
    ...summary.headline,
    streaks,
    activeDaysOutOf: summary.perDay.length,
    workspaces: summary.byWorkspace,
    energy: summary.byEnergy,
    topTags: summary.byTag.slice(0, 8),
    commitDays: summary.commitsPerDay.length,
    totalCommits: summary.commitsPerDay.reduce((n, d) => n + d.commits, 0),
    draftOutcomes: summary.draftOutcomes,
    openOlderThan30d: summary.aging.openOlderThan30d,
    selfComparison: summary.selfComparison,
  };

  try {
    const { content } = await callAI({
      taskKind: 'analytics_narrative',
      tier: 'smart',
      userId: req.user.id,
      temperature: 0.4,
      maxTokens: 1500,
      schema: NARRATIVE_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You analyse a software developer\'s task statistics and surface honest, specific, ' +
            'non-obvious observations. Ground every claim in the numbers you are given. Never ' +
            'invent a statistic, never compare them to other users, and do not flatter. If the ' +
            'data suggests a problem (rising backlog, stale tasks, rejected drafts), say so ' +
            'plainly. 2-4 insights. Return JSON.',
        },
        { role: 'user', content: `Aggregated stats:\n${JSON.stringify(facts, null, 1)}` },
      ],
    });

    const payload = JSON.parse(content);

    await query(
      `INSERT INTO analytics_narrative (user_id, cache_key, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, cache_key) DO UPDATE SET payload = EXCLUDED.payload`,
      [req.user.id, cacheKey, payload]
    );

    res.json(payload);
  } catch (error) {
    console.error('Analytics narrative failed:', error.message);
    // The dashboard's numbers are real regardless; degrade rather than 500.
    res.json({ headline: null, insights: [], recommendation: null, unavailable: true });
  }
}));

export default router;
