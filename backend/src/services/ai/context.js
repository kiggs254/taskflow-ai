import { query } from '../../config/database.js';
import { DEFAULT_TIMEZONE, localDateString } from '../../utils/time.js';
import { WORKSPACES } from './taskSchema.js';

/**
 * Build the grounding context for parseTask.
 *
 * Previously parseTask received the raw input string and nothing else. Its entire
 * personalisation was the static line "Context: User is a busy software developer."
 * It did not know which workspace tab was open, what tags the user already used, or
 * what their tasks normally look like -- so it invented tag synonyms and guessed the
 * workspace from a coin flip. That guess used to override the user's tab.
 */

/**
 * Which workspaces this user can actually see. A hidden tab must never be suggested:
 * a task routed there is invisible in the UI.
 */
export const getAllowedWorkspaces = async (userId) => {
  const result = await query(
    'SELECT show_freelance_tab, show_personal_tab FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  if (!row) return WORKSPACES;

  const allowed = ['job'];
  if (row.show_freelance_tab) allowed.push('freelance');
  if (row.show_personal_tab) allowed.push('personal');
  return allowed;
};

/**
 * The user's most-used tags, so the model reuses "invoicing" instead of minting
 * "invoice", "invoices", "billing" on consecutive tasks.
 */
const getTopTags = async (userId, limit = 25) => {
  const result = await query(
    `SELECT tag, count(*)::int AS n
     FROM tasks, LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END
     ) AS tag
     WHERE user_id = $1
     GROUP BY tag
     ORDER BY n DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map((r) => ({ tag: r.tag, n: r.n }));
};

/** A few recent titles from the target workspace, as few-shot grounding. */
const getRecentTitles = async (userId, workspace, limit = 10) => {
  const result = await query(
    `SELECT title FROM tasks
     WHERE user_id = $1 AND workspace = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, workspace, limit]
  );
  return result.rows.map((r) => r.title);
};

/** Any custom instructions the user configured for Gmail scanning. */
const getPromptInstructions = async (userId) => {
  const result = await query(
    'SELECT prompt_instructions FROM gmail_integrations WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.prompt_instructions || '';
};

export const buildTaskContext = async (userId, { activeWorkspace = 'job', timezone = DEFAULT_TIMEZONE } = {}) => {
  if (!userId) {
    return { allowedWorkspaces: WORKSPACES, topTags: [], recentTitles: [], promptInstructions: '', activeWorkspace, timezone };
  }

  // One round trip each, in parallel: this runs on the interactive add-task path.
  const [allowedWorkspaces, topTags, recentTitles, promptInstructions] = await Promise.all([
    getAllowedWorkspaces(userId),
    getTopTags(userId),
    getRecentTitles(userId, activeWorkspace),
    getPromptInstructions(userId),
  ]);

  return { allowedWorkspaces, topTags, recentTitles, promptInstructions, activeWorkspace, timezone };
};

/**
 * Render context as the system prompt.
 *
 * Ordering is deliberate: the stable, user-specific block goes first and the
 * volatile input last. DeepSeek's context cache keys on the prompt prefix, so a
 * stable prefix makes this extra grounding close to free on repeat calls -- which is
 * why "give the model more context" doesn't have to mean "pay more per call".
 */
export const renderSystemPrompt = (ctx, nowMs = Date.now()) => {
  const lines = [
    'You extract structured task metadata for TaskFlow, a task manager for a software developer.',
    'Return JSON only, matching the required schema exactly.',
    '',
    `Today is ${localDateString(ctx.timezone, nowMs)} (timezone ${ctx.timezone}).`,
    '',
    'WORKSPACES',
    `- The user is currently viewing the "${ctx.activeWorkspace}" workspace.`,
    `- Allowed values: ${ctx.allowedWorkspaces.join(', ')}.`,
    `- Default to "${ctx.activeWorkspace}" unless the text clearly belongs elsewhere.`,
    '- "job" = employed work: code, tickets, standups, deploys, colleagues, meetings.',
    '- "freelance" = paid client work outside the job: proposals, invoices, client comms.',
    '- "personal" = life admin unrelated to any work: family, health, errands, hobbies.',
    '- Set workspaceConfidence < 0.5 when genuinely unsure. Do not guess confidently.',
    '',
    'ENERGY',
    '- high = deep focus (debugging, architecture, writing).',
    '- medium = moderate (code review, planning).',
    '- low = shallow (email, admin, scheduling).',
  ];

  if (ctx.topTags.length) {
    lines.push(
      '',
      'EXISTING TAGS (reuse these instead of inventing near-duplicates):',
      ctx.topTags.map((t) => `- ${t.tag} (${t.n})`).join('\n')
    );
  }

  if (ctx.recentTitles.length) {
    lines.push(
      '',
      `RECENT "${ctx.activeWorkspace}" TASK TITLES (match this style):`,
      ctx.recentTitles.map((t) => `- ${t}`).join('\n')
    );
  }

  if (ctx.promptInstructions && ctx.promptInstructions.trim().length > 0) {
    lines.push('', 'USER INSTRUCTIONS (highest priority):', ctx.promptInstructions.trim());
  }

  return lines.join('\n');
};
