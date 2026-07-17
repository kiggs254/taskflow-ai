import path from 'path';
import { query } from '../config/database.js';
import { syncTask } from './taskService.js';
import { callAI } from './ai/callAI.js';
import {
  DEFAULT_TIMEZONE,
  localDateString,
  isValidTimezone,
  startOfLocalDayMs,
  endOfLocalDayMs,
} from '../utils/time.js';

/**
 * Logging work done in an external agent (Claude Code) as completed tasks.
 *
 * Two rules shape everything here:
 *   1. Never log personal work. Decided by an explicit folder allowlist, never by a
 *      classifier — a wrong guess could put a personal session into a report that
 *      goes to a team Slack channel.
 *   2. Never double-count. GitHub already turns commits in tracked repos into tasks;
 *      this covers what GitHub cannot see.
 */

const WORKSPACES = ['job', 'freelance', 'personal'];

// ---------------------------------------------------------------------------
// Settings / policy
// ---------------------------------------------------------------------------

export const getAgentSettings = async (userId) => {
  const result = await query('SELECT * FROM agent_settings WHERE user_id = $1', [userId]);
  if (result.rows[0]) return result.rows[0];

  const created = await query(
    'INSERT INTO agent_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING *',
    [userId]
  );
  return (
    created.rows[0] ??
    (await query('SELECT * FROM agent_settings WHERE user_id = $1', [userId])).rows[0]
  );
};

const sanitizeWorkPaths = (value) => {
  if (!Array.isArray(value)) return null;
  return value
    .filter((r) => r && typeof r.path === 'string' && r.path.trim())
    .map((r) => ({
      // Trailing slashes would break prefix matching ('/a/' vs '/a').
      path: path.resolve(r.path.trim()).replace(/\/+$/, '') || '/',
      workspace: WORKSPACES.includes(r.workspace) ? r.workspace : 'job',
    }))
    .slice(0, 50);
};

export const updateAgentSettings = async (userId, patch) => {
  await getAgentSettings(userId);

  const sets = [];
  const params = [userId];

  if (typeof patch.enabled === 'boolean') {
    params.push(patch.enabled);
    sets.push(`enabled = $${params.length}`);
  }

  const paths = sanitizeWorkPaths(patch.workPaths);
  if (paths) {
    params.push(JSON.stringify(paths));
    sets.push(`work_paths = $${params.length}`);
  }

  if (sets.length) {
    await query(`UPDATE agent_settings SET ${sets.join(', ')} WHERE user_id = $1`, params);
  }
  return getAgentSettings(userId);
};

/**
 * Resolve a directory to a workspace, or null if it isn't work.
 *
 * Longest matching prefix wins, so a sub-folder can override its parent (e.g.
 * ~/Projects => job, but ~/Projects/side-hustle => personal).
 */
export const matchWorkPath = (dir, workPaths = []) => {
  if (!dir || typeof dir !== 'string') return null;

  // Case-insensitive, because these are macOS/Windows paths: there,
  // "/Desktop/Random AI tasks" and "/Desktop/random ai tasks" are literally the same
  // folder. Comparing exactly meant a capitalisation slip when typing the folder into
  // Settings produced silent, permanent non-logging with nothing to explain it -- the
  // worst possible failure for a background feature.
  //
  // The trade-off is a Linux server could over-match two folders differing only in
  // case. That needs someone to keep genuinely distinct `Work/` and `work/` folders,
  // which is far less likely than a typo, and its cost (a task filed under the right
  // person, wrong folder) is far lower than never recording anything.
  const target = path.resolve(dir).toLowerCase();

  let best = null;
  for (const rule of workPaths) {
    const root = path.resolve(rule.path).replace(/\/+$/, '');
    const rootLower = root.toLowerCase();
    // Compare on a path boundary: '/a/bcd' must not match the rule '/a/b'.
    const isMatch = target === rootLower || target.startsWith(`${rootLower}${path.sep}`);
    if (!isMatch) continue;
    if (!best || root.length > best.root.length) best = { root, workspace: rule.workspace };
  }

  return best ? best.workspace : null;
};

// ---------------------------------------------------------------------------
// GitHub overlap
// ---------------------------------------------------------------------------

/**
 * `git@github.com:owner/repo.git` | `https://github.com/owner/repo` -> {owner, name}
 */
export const parseGitRemote = (remote) => {
  if (typeof remote !== 'string' || !remote.trim()) return null;
  const cleaned = remote.trim().replace(/\.git$/, '');
  const match =
    cleaned.match(/^git@[^:]+:([^/]+)\/(.+)$/) ||
    cleaned.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?[^/]+\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
};

/**
 * Is this repo one GitHub will already produce tasks for?
 *
 * Gates on `selected`, NOT on whether the commits are in processed_commits yet. The
 * scanner runs on an interval and only looks back to local midnight, so an agent
 * reporting right after committing is normally *ahead* of it: "SHA absent" means
 * "not ingested yet", not "never will be". Gating on the ledger would double-count.
 *
 * A repo that's known but not selected produces no GitHub task, so work there is
 * ours to log.
 */
export const findCoveredRepo = async (userId, gitRemote) => {
  const parsed = parseGitRemote(gitRemote);
  if (!parsed) return null;

  const result = await query(
    `SELECT repo_id, owner, name, selected
     FROM github_repos
     WHERE user_id = $1 AND lower(owner) = lower($2) AND lower(name) = lower($3)`,
    [userId, parsed.owner, parsed.name]
  );

  const row = result.rows[0];
  return row?.selected ? row : null;
};

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

const SUMMARY_SCHEMA = {
  name: 'session_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: {
      summary: {
        type: 'string',
        description: "One past-tense line, max 70 chars, describing what was done.",
      },
    },
  },
};

const summariseSession = async (userId, projectSlug, prompts, changedPaths) => {
  const fileCount = changedPaths.length;
  const fallback = fileCount
    ? `${projectSlug} — updated ${fileCount} file${fileCount > 1 ? 's' : ''}`
    : `${projectSlug} — working session`;

  // Nothing to go on: don't ask a model to invent an accomplishment.
  if (!prompts.length && !fileCount) return fallback;

  try {
    const { content } = await callAI({
      taskKind: 'agent_session_summary',
      tier: 'smart',
      userId,
      temperature: 0.2,
      maxTokens: 120,
      schema: SUMMARY_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You summarise one coding session into a single past-tense line for a standup ' +
            'report. Say concretely what changed. The requests describe intent; the files ' +
            'show where it landed. No filler, no "various changes", no file counts. If the ' +
            'requests are vague, describe the files instead of inventing work. Return JSON.',
        },
        {
          role: 'user',
          content:
            `Project: ${projectSlug}\n\n` +
            `What was asked:\n${prompts.slice(0, 12).map((p) => `- ${p}`).join('\n') || '(none)'}\n\n` +
            `Files touched:\n${changedPaths.slice(0, 40).map((p) => `- ${p}`).join('\n') || '(none)'}`,
        },
      ],
    });

    const summary = JSON.parse(content)?.summary;
    if (!summary || typeof summary !== 'string') return fallback;
    return `${projectSlug} — ${summary.trim().slice(0, 70)}`;
  } catch (error) {
    console.error('Agent: session summary failed, using fallback:', error.message);
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

const slugify = (value) =>
  path.basename(value || 'work').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'work';

/**
 * Rebuild the day's task for one project from every session row recorded for it.
 *
 * Rebuilt from the ledger rather than from the payload in hand — the same idiom that
 * makes the commit scanner idempotent. A re-reported session converges instead of
 * duplicating.
 */
const rebuildDayTask = async (userId, projectSlug, workspace, day) => {
  // Selected by the `day` column rather than an ended_at range: `day` is the local
  // date the work was recorded for, and it's what the unique key is on, so this can't
  // drift from what was written.
  const sessions = (
    await query(
      `SELECT session_id, summary, started_at, ended_at
       FROM agent_sessions
       WHERE user_id = $1 AND project_slug = $2 AND day = $3
       ORDER BY ended_at ASC`,
      [userId, projectSlug, day]
    )
  ).rows;

  if (!sessions.length) return null;

  // userId in the id: see the cross-tenant note on the gh- ids. Deterministic so a
  // re-report upserts rather than piling up.
  const taskId = `agent-${userId}-${projectSlug}-${day}`;

  await syncTask(userId, {
    id: taskId,
    title:
      sessions.length === 1
        ? sessions[0].summary
        : `${projectSlug} — ${sessions.length} sessions`,
    description:
      `${projectSlug} — ${sessions.length} Claude Code session${sessions.length > 1 ? 's' : ''} on ${day}\n\n` +
      sessions.map((s) => `- ${s.summary}`).join('\n'),
    workspace,
    energy: 'medium',
    status: 'done',
    estimatedTime: null,
    tags: ['claude-code', projectSlug],
    dependencies: [],
    subtasks: sessions.map((s, i) => ({
      id: `${taskId}-${i}`,
      title: String(s.summary || '').slice(0, 120),
      completed: true,
      // Numeric, not ISO: reportService matches subtask completedAt with ~ '^[0-9]+$'.
      completedAt: Number(s.ended_at),
    })),
    createdAt: Number(sessions[0].started_at),
    completedAt: Number(sessions[sessions.length - 1].ended_at),
  });

  await query(
    `UPDATE agent_sessions SET task_id = $3
     WHERE user_id = $1 AND project_slug = $2 AND day = $4`,
    [userId, projectSlug, taskId, day]
  );

  return { taskId, sessions: sessions.length };
};

/**
 * Record one finished agent session.
 *
 * @param {object} payload {sessionId, cwd, projectDir, gitRemote, commitShas,
 *                          changedPaths, prompts, startedAt, endedAt, timezone}
 */
export const logWork = async (userId, payload) => {
  const {
    sessionId,
    cwd,
    projectDir,
    gitRemote = null,
    commitShas = [],
    changedPaths = [],
    prompts = [],
    startedAt,
    endedAt,
    timezone,
  } = payload || {};

  if (!sessionId) throw new Error('sessionId is required');

  const settings = await getAgentSettings(userId);
  if (!settings.enabled) return { logged: false, reason: 'agent_logging_disabled' };

  // `cwd` is wherever the session happened to be when the hook fired, which is not
  // necessarily the project root — prefer the explicit project dir.
  const root = projectDir || cwd;
  const workspace = matchWorkPath(root, settings.work_paths || []);

  // The server re-checks the allowlist even though the hook already did: the hook's
  // copy is a cache, and this endpoint is reachable with just a token.
  if (!workspace) return { logged: false, reason: 'not_a_work_path' };

  // Work GitHub already covers.
  const coveredRepo = commitShas.length > 0 ? await findCoveredRepo(userId, gitRemote) : null;

  // A mixed session commits to a tracked repo *and* touches things outside it. Drop
  // only the covered part; whatever is left is work nothing else records.
  const repoRoot = coveredRepo ? path.resolve(root) : null;
  const uncoveredPaths = repoRoot
    ? changedPaths.filter((p) => {
        const abs = path.resolve(p);
        return abs !== repoRoot && !abs.startsWith(`${repoRoot}${path.sep}`);
      })
    : changedPaths;

  if (coveredRepo && uncoveredPaths.length === 0) {
    return {
      logged: false,
      reason: 'covered_by_github',
      repo: `${coveredRepo.owner}/${coveredRepo.name}`,
    };
  }

  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const ended = Number(endedAt) || Date.now();
  const started = Number(startedAt) || ended;
  const projectSlug = slugify(root);

  const summary = await summariseSession(userId, projectSlug, prompts, uncoveredPaths);

  const day = localDateString(tz, ended);

  // Keyed on (user_id, session_id, day), not just session_id.
  //
  // A session_id is stable across resumes, and resuming an old session is the normal
  // way to work. Keyed on session_id alone, resuming on Wednesday rewrote Monday's
  // row and moved its ended_at -- Monday's work vanished from the ledger, its task
  // stopped being backed by anything, and that day silently stopped counting toward
  // the report gate. Per-day rows mean each day of a long session keeps its own
  // record, while a /clear on the same day still updates in place.
  await query(
    `INSERT INTO agent_sessions (
       user_id, session_id, day, project_slug, project_path, workspace, summary,
       prompts, changed_paths, started_at, ended_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, session_id, day) DO UPDATE SET
       summary = EXCLUDED.summary,
       prompts = EXCLUDED.prompts,
       changed_paths = EXCLUDED.changed_paths,
       ended_at = EXCLUDED.ended_at`,
    [
      userId,
      sessionId,
      day,
      projectSlug,
      root,
      workspace,
      summary,
      JSON.stringify(prompts.slice(0, 50)),
      JSON.stringify(uncoveredPaths.slice(0, 200)),
      started,
      ended,
    ]
  );

  const rebuilt = await rebuildDayTask(userId, projectSlug, workspace, day);

  return {
    logged: true,
    workspace,
    summary,
    taskId: rebuilt?.taskId,
    sessionsToday: rebuilt?.sessions,
    droppedCoveredPaths: coveredRepo ? changedPaths.length - uncoveredPaths.length : 0,
  };
};
