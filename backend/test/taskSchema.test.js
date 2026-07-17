import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndCoerceTask, PARSE_TASK_SCHEMA } from '../src/services/ai/taskSchema.js';

test('coerces sloppy model output rather than rejecting it', () => {
  const r = validateAndCoerceTask({
    title: 'Fix the auth bug',
    energy: 'HIGH',
    estimatedTime: '45',
    tags: ['A', 'b', 'c', 'd', 'e'],
    workspace: 'job',
    confidence: 0.8,
    dueDate: '2026-08-01',
    subtasks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  });

  assert.equal(r.energy, 'high');
  assert.equal(r.estimatedTime, 45);
  assert.deepEqual(r.tags, ['a', 'b', 'c']);       // capped and lowercased
  assert.equal(r.subtasks.length, 5);              // capped
  assert.equal(r.dueDate, Date.parse('2026-08-01'));
});

test('clamps and defaults nonsense instead of throwing away the task', () => {
  const r = validateAndCoerceTask(
    { estimatedTime: 99999, energy: 'bogus', tags: 'notanarray', confidence: 5, dueDate: 'garbage' },
    { fallbackTitle: 'raw input' }
  );

  assert.equal(r.estimatedTime, 480);
  assert.equal(r.energy, 'medium');
  assert.deepEqual(r.tags, []);
  assert.equal(r.confidence, 1);
  assert.equal(r.dueDate, null);
  assert.equal(r.title, 'raw input');
});

test('never suggests a workspace whose tab the user has hidden', () => {
  // Routing a task into a hidden workspace is how tasks silently disappeared.
  assert.equal(
    validateAndCoerceTask({ workspace: 'personal' }, { allowedWorkspaces: ['job'] }).workspaceSuggestions,
    undefined
  );
  assert.equal(
    validateAndCoerceTask({ workspace: 'personal' }, { allowedWorkspaces: ['job', 'personal'] }).workspaceSuggestions,
    'personal'
  );
  assert.equal(
    validateAndCoerceTask({ workspace: 'atlantis' }, { allowedWorkspaces: ['job', 'personal'] }).workspaceSuggestions,
    undefined
  );
});

test('schema is shaped for strict structured output', () => {
  assert.equal(PARSE_TASK_SCHEMA.schema.additionalProperties, false);
  assert.ok(PARSE_TASK_SCHEMA.schema.required.includes('workspace'));
  assert.ok(PARSE_TASK_SCHEMA.schema.required.includes('confidence'));
});
