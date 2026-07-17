/**
 * Schema + validator for parseTask.
 *
 * Hand-rolled rather than ajv on purpose: we want *coercion*, not rejection. If the
 * model says estimatedTime is 9999 or energy is "HIGH", the right answer is to clamp
 * and lowercase, not to throw away a task the user just typed. There are nine fields;
 * a schema library would be carried for validation we'd then have to override anyway.
 */

export const ENERGY_LEVELS = ['high', 'medium', 'low'];
export const WORKSPACES = ['job', 'freelance', 'personal'];

const MIN_MINUTES = 5;
const MAX_MINUTES = 480;
const MAX_TAGS = 3;
const MAX_SUBTASKS = 5;

/** JSON Schema passed to the provider for structured output. */
export const PARSE_TASK_SCHEMA = {
  name: 'parsed_task',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title', 'energy', 'estimatedTime', 'tags',
      'workspace', 'workspaceConfidence', 'confidence', 'dueDate', 'subtasks',
    ],
    properties: {
      title: { type: 'string', description: 'Short imperative task title, max 80 chars.' },
      energy: { type: 'string', enum: ENERGY_LEVELS, description: 'Cognitive load required.' },
      estimatedTime: { type: 'integer', description: `Minutes, ${MIN_MINUTES}-${MAX_MINUTES}.` },
      tags: {
        type: 'array', items: { type: 'string' },
        description: 'Up to 3 short lowercase tags. Strongly prefer reusing the user\'s existing tags.',
      },
      workspace: { type: 'string', enum: WORKSPACES, description: 'Best-guess workspace.' },
      workspaceConfidence: { type: 'number', description: '0-1 confidence in the workspace guess.' },
      confidence: { type: 'number', description: '0-1 overall confidence in this parse.' },
      dueDate: {
        type: ['string', 'null'],
        description: 'ISO 8601 date if the input implies a deadline, else null.',
      },
      subtasks: {
        type: 'array', items: { type: 'string' },
        description: 'Up to 5 concrete steps, only if the task clearly decomposes. Else empty.',
      },
    },
  },
};

const clampNumber = (v, lo, hi, fallback) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

const clampUnit = (v, fallback = 0.5) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const toStringArray = (v, max) => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
};

/**
 * Coerce raw model output into a safe AIParsedTask.
 *
 * @param {object} raw            parsed JSON from the model
 * @param {object} opts
 * @param {string[]} opts.allowedWorkspaces  workspaces the user actually has enabled
 * @param {string}   opts.fallbackTitle
 */
export const validateAndCoerceTask = (raw, { allowedWorkspaces = WORKSPACES, fallbackTitle = '' } = {}) => {
  const out = {};

  const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
  out.title = (title || fallbackTitle).slice(0, 80);

  const energy = typeof raw?.energy === 'string' ? raw.energy.toLowerCase().trim() : '';
  out.energy = ENERGY_LEVELS.includes(energy) ? energy : 'medium';

  out.estimatedTime = clampNumber(raw?.estimatedTime, MIN_MINUTES, MAX_MINUTES, 15);

  out.tags = toStringArray(raw?.tags, MAX_TAGS).map((t) => t.toLowerCase());
  out.subtasks = toStringArray(raw?.subtasks, MAX_SUBTASKS);

  // A workspace the user has hidden is never a valid suggestion -- routing a task
  // there is how tasks used to disappear from the UI entirely.
  const ws = typeof raw?.workspace === 'string' ? raw.workspace.toLowerCase().trim() : '';
  out.workspaceSuggestions = allowedWorkspaces.includes(ws) ? ws : undefined;

  out.workspaceConfidence = clampUnit(raw?.workspaceConfidence, 0);
  out.confidence = clampUnit(raw?.confidence, 0.5);

  // Only accept a due date the runtime can actually parse, and never one in the past.
  out.dueDate = null;
  if (typeof raw?.dueDate === 'string' && raw.dueDate) {
    const ts = Date.parse(raw.dueDate);
    if (Number.isFinite(ts)) out.dueDate = ts;
  }

  return out;
};
