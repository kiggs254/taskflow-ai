import path from 'path';
import { query } from '../config/database.js';
import { truncateAtWord } from '../utils/text.js';
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

/**
 * Summary AND items.
 *
 * Asking for a single line meant there was nothing to expand into: the same string
 * became the title, the only subtask and the description. The request is what carries
 * the meaning ("save submissions in the admin so they can be viewed and exported"),
 * and it usually contains several distinct deliverables -- those are the subtasks.
 */
const SUMMARY_SCHEMA = {
  name: 'session_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['project', 'summary', 'items'],
    properties: {
      project: {
        type: 'string',
        description:
          'A short 2-5 word name for WHAT was worked on -- a feature or project handle, ' +
          'inferred from the work itself, e.g. "WooCommerce webhook auto-reenabler" or ' +
          '"Mogo category filtering". Title case, no trailing punctuation. This is the ' +
          'headline; do NOT use the folder name.',
      },
      summary: {
        type: 'string',
        description:
          'One past-tense line, max 70 chars, naming the outcome. Describe what the ' +
          'work achieved, not how many files moved.',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The distinct things done, 1-6 of them, each a short past-tense phrase. ' +
          'These are read as standup bullets, so make each one stand alone.',
      },
    },
  },
};

// Fallback project label from the folder, only used when the AI is unavailable.
// De-slugged ("Random-AI-tasks" -> "Random AI tasks") so even the fallback doesn't
// show a raw slug.
const labelFromSlug = (slug) => String(slug || 'work').replace(/[-_]+/g, ' ').trim() || 'work';

const summariseSession = async (userId, projectSlug, prompts, changedPaths) => {
  const fileCount = changedPaths.length;
  // The label the title leads with. Prefer what the AI infers from the work; fall back
  // to the de-slugged folder name, never the raw slug.
  const folderLabel = labelFromSlug(projectSlug);
  // Deliberately dull: if the model can't tell us what happened, say what we know for
  // certain rather than inventing an accomplishment.
  const fallback = {
    summary: fileCount
      ? `${folderLabel} — updated ${fileCount} file${fileCount > 1 ? 's' : ''}`
      : `${folderLabel} — working session`,
    items: [],
  };

  if (!prompts.length && !fileCount) return fallback;

  try {
    const { content } = await callAI({
      taskKind: 'agent_session_summary',
      tier: 'smart',
      userId,
      temperature: 0.2,
      maxTokens: 800,
      schema: SUMMARY_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You turn one coding session into a standup entry: a short project name, a ' +
            'headline, and the distinct things that were done.\n\n' +
            'The requests are the source of truth for WHAT was wanted and WHY — lead with ' +
            'that outcome, in the requester\'s terms. The file paths only corroborate where ' +
            'it landed; they are not the story.\n\n' +
            'Name the `project` for what was actually built (e.g. "WooCommerce webhook ' +
            'auto-reenabler"), inferred from the work — NOT the containing folder, which is ' +
            'often a catch-all and means nothing.\n\n' +
            'A request like "the client needs submissions saved in the admin so they can be ' +
            'viewed and exported" should read as "admin view and export for form submissions" ' +
            '— with the storage, the view and the export as separate items. Never "updated 4 ' +
            'files", never "various changes", never a file count.\n\n' +
            'Write for someone who did not see the session. If the requests are too vague to ' +
            'tell, describe the files plainly rather than inventing work. Return json.',
        },
        {
          role: 'user',
          content:
            // The folder is a weak hint only, and explicitly labelled as such so the model
            // doesn't echo it back as the project name -- that's the whole bug being fixed.
            `Folder (a hint only, may be a catch-all — do not use as the name): ${projectSlug}\n\n` +
            `What was requested (most important):\n${
              prompts.slice(0, 12).map((p) => `- ${p}`).join('\n') || '(none captured)'
            }\n\n` +
            `Files touched (supporting evidence only):\n${
              changedPaths.slice(0, 40).map((p) => `- ${p}`).join('\n') || '(none)'
            }`,
        },
      ],
    });

    const parsed = JSON.parse(content);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';

    if (!summary) {
      // The call succeeded but the shape is wrong -- the single hardest failure to
      // diagnose here, because telemetry records ok=true and the only symptom is a
      // generic title. Say exactly what came back instead of silently degrading.
      console.error(
        'Agent: model returned no `summary` field; falling back. ' +
          `Keys received: [${Object.keys(parsed ?? {}).join(', ') || 'none'}]. ` +
          `Raw (first 300): ${String(content).slice(0, 300)}`
      );
      return fallback;
    }

    const items = Array.isArray(parsed?.items)
      ? parsed.items
          .filter((i) => typeof i === 'string' && i.trim())
          .map((i) => truncateAtWord(i, 110))
          .slice(0, 6)
      : [];

    // The project label comes from the work, not the folder. Fall back to the
    // de-slugged folder only if the model didn't provide one.
    const project =
      typeof parsed?.project === 'string' && parsed.project.trim()
        ? truncateAtWord(parsed.project.trim(), 60)
        : folderLabel;

    // truncateAtWord, not slice: a hard cut produced "…added showroom s", which reads
    // as a bug rather than an abbreviation.
    return { summary: `${project} — ${truncateAtWord(summary, 80)}`, items };
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
 * Rebuild the task for ONE session on a day, from its ledger row.
 *
 * One task per session, not per folder. Grouping by folder merged two unrelated pieces
 * of work done in the same catch-all folder ("Random AI tasks") into a single task with
 * a run-on narrative -- e.g. a webhook re-enabler and a category-filter change became
 * one "we built X, and we also refined Y" entry. A session is the natural unit of one
 * task; resuming the *same* session (same session_id) still updates in place, since the
 * ledger row and this id are keyed on (session_id, day).
 *
 * Rebuilt from the ledger rather than the payload in hand -- the idiom that makes the
 * commit scanner idempotent: a re-reported session converges instead of duplicating.
 */
const rebuildSessionTask = async (userId, sessionId, day) => {
  const row = (
    await query(
      `SELECT session_id, project_slug, workspace, summary, items, changed_paths,
              started_at, ended_at
       FROM agent_sessions
       WHERE user_id = $1 AND session_id = $2 AND day = $3`,
      [userId, sessionId, day]
    )
  ).rows[0];

  if (!row) return null;

  // userId in the id: see the cross-tenant note on the gh- ids. session_id + day makes
  // it deterministic and per-session, so a re-report upserts the same task.
  const taskId = `agent-${userId}-${sessionId}-${day}`;

  // Subtasks are the work itself, not a restatement of the title.
  const items = Array.isArray(row.items) ? row.items : [];
  const subtasks = (items.length ? items.map((i) => String(i)) : [String(row.summary || 'Session')]).map(
    (title, i) => ({
      id: `${taskId}-${i}`,
      title: title.slice(0, 120),
      completed: true,
      // Numeric, not ISO: reportService matches subtask completedAt with ~ '^[0-9]+$'.
      completedAt: Number(row.ended_at),
    })
  );

  const files = [...new Set(Array.isArray(row.changed_paths) ? row.changed_paths : [])];
  const description = [
    `Claude Code session on ${day}`,
    files.length ? `\nFiles touched (${files.length}):\n${files.slice(0, 30).map((f) => `- ${f}`).join('\n')}` : '',
    files.length > 30 ? `\n…and ${files.length - 30} more` : '',
  ].filter(Boolean).join('\n');

  await syncTask(userId, {
    id: taskId,
    title: row.summary,
    description,
    workspace: row.workspace,
    energy: 'medium',
    status: 'done',
    estimatedTime: null,
    tags: ['claude-code', row.project_slug],
    dependencies: [],
    subtasks,
    createdAt: Number(row.started_at),
    completedAt: Number(row.ended_at),
  });

  await query(
    `UPDATE agent_sessions SET task_id = $4
     WHERE user_id = $1 AND session_id = $2 AND day = $3`,
    [userId, sessionId, day, taskId]
  );

  return { taskId };
};

/**
 * Remove agent tasks no longer backed by any session row -- e.g. an old folder-grouped
 * task orphaned once its sessions were rebuilt as per-session tasks. The task_id FK is
 * ON DELETE SET NULL, so this can't cascade into the ledger.
 */
const pruneOrphanedAgentTasks = async (userId) => {
  const { rowCount } = await query(
    `DELETE FROM tasks
     WHERE user_id = $1 AND id LIKE 'agent-%'
       AND NOT EXISTS (SELECT 1 FROM agent_sessions WHERE task_id = tasks.id)`,
    [userId]
  );
  return rowCount;
};

/**
 * Record one finished agent session.
 *
 * @param {object} payload {sessionId, cwd, projectDir, gitRemote, commitShas,
 *                          changedPaths, prompts, startedAt, endedAt, timezone}
 */
/**
 * Re-summarise sessions already in the ledger, from their stored prompts.
 *
 * The summary is computed once at log time and cached on the row; the rebuild reads it
 * rather than recomputing. That's right in the steady state — re-running a
 * smart-tier call on every rebuild would be absurd — but it means a session logged
 * while summarisation was broken keeps its fallback title forever, even after the
 * bug is fixed. Every session logged before the truncation fix is in exactly that
 * state.
 *
 * Recoverable only because `prompts` is persisted: the hook deletes its local log at
 * session end, so this row is the last copy of what was asked. Without the column
 * the only repair would be redoing the work.
 *
 * Each session is rebuilt as its own task, and any folder-grouped task orphaned by the
 * switch to per-session tasks is pruned at the end. This is also the migration path:
 * re-running it over old sessions splits a previously-merged folder task apart.
 */
export const resummariseSessions = async (userId, { day, sessionId, force = false } = {}) => {
  const filters = ['user_id = $1'];
  const params = [userId];
  if (day) { params.push(day); filters.push(`day = $${params.length}`); }
  if (sessionId) { params.push(sessionId); filters.push(`session_id = $${params.length}`); }
  // Default to only the rows that look broken: no items means the AI never returned a
  // usable shape. `force` re-does the lot.
  if (!force) filters.push(`(items IS NULL OR jsonb_array_length(items) = 0)`);

  const sessions = (
    await query(
      `SELECT session_id, day, project_slug, workspace, prompts, changed_paths
       FROM agent_sessions
       WHERE ${filters.join(' AND ')}
       ORDER BY ended_at ASC`,
      params
    )
  ).rows;

  const results = [];

  for (const s of sessions) {
    const prompts = Array.isArray(s.prompts) ? s.prompts : [];
    const changedPaths = Array.isArray(s.changed_paths) ? s.changed_paths : [];

    // Nothing to work from: a re-run would produce the same fallback and bill for it.
    if (!prompts.length && !changedPaths.length) {
      results.push({ sessionId: s.session_id, skipped: 'no stored prompts or paths' });
      continue;
    }

    const { summary, items } = await summariseSession(
      userId, s.project_slug, prompts, changedPaths
    );

    await query(
      `UPDATE agent_sessions SET summary = $1, items = $2
       WHERE user_id = $3 AND session_id = $4 AND day = $5`,
      [summary, JSON.stringify(items), userId, s.session_id, s.day]
    );

    await rebuildSessionTask(userId, s.session_id, s.day);
    results.push({ sessionId: s.session_id, summary, items: items.length });
  }

  // Drop the old folder-grouped tasks the per-session rebuild replaced.
  const pruned = await pruneOrphanedAgentTasks(userId);

  return { resummarised: results.length, tasksRebuilt: results.length, pruned, results };
};

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

  const { summary, items } = await summariseSession(userId, projectSlug, prompts, uncoveredPaths);

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
       items, prompts, changed_paths, started_at, ended_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, session_id, day) DO UPDATE SET
       summary = EXCLUDED.summary,
       items = EXCLUDED.items,
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
      JSON.stringify(items),
      JSON.stringify(prompts.slice(0, 50)),
      JSON.stringify(uncoveredPaths.slice(0, 200)),
      started,
      ended,
    ]
  );

  const rebuilt = await rebuildSessionTask(userId, sessionId, day);

  return {
    logged: true,
    workspace,
    summary,
    taskId: rebuilt?.taskId,
    droppedCoveredPaths: coveredRepo ? changedPaths.length - uncoveredPaths.length : 0,
  };
};
