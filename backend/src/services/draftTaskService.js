import crypto from 'crypto';
import { query } from '../config/database.js';
import { syncTask } from './taskService.js';
import { parseTask } from './aiService.js';

/**
 * Get all draft tasks for a user
 */
export const getDraftTasks = async (userId, status = 'pending') => {
  const result = await query(
    `SELECT id, user_id, source, source_id, title, description, workspace, energy,
            estimated_time as "estimatedTime", tags, due_date as "dueDate",
            status, ai_confidence as "aiConfidence", created_at as "createdAt"
     FROM draft_tasks
     WHERE user_id = $1 AND status = $2
     ORDER BY created_at DESC`,
    [userId, status]
  );

  return result.rows.map((task) => ({
    ...task,
    tags: task.tags || [],
  }));
};

/**
 * Get a single draft task by ID
 */
export const getDraftTask = async (userId, draftId) => {
  const result = await query(
    `SELECT id, user_id, source, source_id, title, description, workspace, energy,
            estimated_time as "estimatedTime", tags, due_date as "dueDate",
            status, ai_confidence as "aiConfidence", created_at as "createdAt"
     FROM draft_tasks
     WHERE id = $1 AND user_id = $2`,
    [draftId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Draft task not found');
  }

  const task = result.rows[0];
  return {
    ...task,
    tags: task.tags || [],
  };
};

/**
 * Check if a draft task already exists for a given source and sourceId
 */
export const draftTaskExists = async (userId, source, sourceId) => {
  const result = await query(
    `SELECT id FROM draft_tasks 
     WHERE user_id = $1 AND source = $2 AND source_id = $3 
     AND status IN ('pending', 'approved')`,
    [userId, source, sourceId]
  );
  return result.rows.length > 0;
};

/**
 * Check if a task already exists for a given sourceId (in description metadata)
 */
export const taskExistsForSource = async (userId, sourceId) => {
  const result = await query(
    `SELECT id FROM tasks 
     WHERE user_id = $1 AND description LIKE $2`,
    [userId, `%"messageId":"${sourceId}"%`]
  );
  return result.rows.length > 0;
};

/**
 * Create a draft task (with duplicate prevention)
 */
export const createDraftTask = async (userId, draftData) => {
  const {
    source,
    sourceId,
    title,
    description,
    workspace,
    energy,
    estimatedTime,
    tags = [],
    dueDate,
    aiConfidence,
  } = draftData;

  // Check for existing draft with same sourceId (prevent duplicates)
  if (sourceId) {
    const exists = await draftTaskExists(userId, source, sourceId);
    if (exists) {
      console.log(`Draft task already exists for sourceId: ${sourceId}, skipping...`);
      return null; // Return null to indicate skipped
    }
    
    // Also check if a task already exists for this source
    const taskExists = await taskExistsForSource(userId, sourceId);
    if (taskExists) {
      console.log(`Task already exists for sourceId: ${sourceId}, skipping draft creation...`);
      return null;
    }
  }

  const result = await query(
    `INSERT INTO draft_tasks (
      user_id, source, source_id, title, description, workspace, energy,
      estimated_time, tags, due_date, ai_confidence, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
    RETURNING id, user_id, source, source_id, title, description, workspace, energy,
              estimated_time as "estimatedTime", tags, due_date as "dueDate",
              status, ai_confidence as "aiConfidence", created_at as "createdAt"`,
    [
      userId,
      source,
      sourceId,
      title,
      description || null,
      workspace || null,
      energy || null,
      estimatedTime || null,
      JSON.stringify(tags),
      dueDate || null,
      aiConfidence || null,
    ]
  );

  const task = result.rows[0];
  return {
    ...task,
    tags: task.tags || [],
  };
};

/**
 * Approve a draft task and create it as a real task
 */
export const approveDraftTask = async (userId, draftId, edits = {}) => {
  // Get the draft task
  const draft = await getDraftTask(userId, draftId);

  // Auto-correct title using AI if possible
  let aiTitle = '';
  try {
    const aiResult = await parseTask(
      `${draft.title}\n${draft.description || ''}`,
      'openai'
    );
    aiTitle = aiResult?.title || '';
  } catch (err) {
    // Ignore AI errors; fallback to existing title
  }

  // Merge any edits
  const taskData = {
    id: crypto.randomUUID(),
    title: edits.title || aiTitle || draft.title,
    description: edits.description || draft.description,
    workspace: edits.workspace || draft.workspace || 'personal',
    energy: edits.energy || draft.energy || 'medium',
    status: 'todo',
    estimatedTime: edits.estimatedTime || draft.estimatedTime,
    tags: edits.tags || draft.tags || [],
    dependencies: [],
    createdAt: Date.now(),
    dueDate: edits.dueDate || draft.dueDate,
  };

  // Create the real task
  await syncTask(userId, taskData);

  // Update draft status to approved
  await query(
    'UPDATE draft_tasks SET status = $1 WHERE id = $2 AND user_id = $3',
    ['approved', draftId, userId]
  );

  return { success: true, task: taskData };
};

/**
 * Reject a draft task
 */
export const rejectDraftTask = async (userId, draftId) => {
  const result = await query(
    'UPDATE draft_tasks SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
    ['rejected', draftId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Draft task not found');
  }

  return { success: true };
};

/**
 * Edit a draft task before approving
 */
export const editDraftTask = async (userId, draftId, edits) => {
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (edits.title !== undefined) {
    updates.push(`title = $${paramCount++}`);
    values.push(edits.title);
  }
  if (edits.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(edits.description);
  }
  if (edits.workspace !== undefined) {
    updates.push(`workspace = $${paramCount++}`);
    values.push(edits.workspace);
  }
  if (edits.energy !== undefined) {
    updates.push(`energy = $${paramCount++}`);
    values.push(edits.energy);
  }
  if (edits.estimatedTime !== undefined) {
    updates.push(`estimated_time = $${paramCount++}`);
    values.push(edits.estimatedTime);
  }
  if (edits.tags !== undefined) {
    updates.push(`tags = $${paramCount++}`);
    values.push(JSON.stringify(edits.tags));
  }
  if (edits.dueDate !== undefined) {
    updates.push(`due_date = $${paramCount++}`);
    values.push(edits.dueDate);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(draftId, userId);

  const result = await query(
    `UPDATE draft_tasks SET ${updates.join(', ')}
     WHERE id = $${paramCount++} AND user_id = $${paramCount++}
     RETURNING id, user_id, source, source_id, title, description, workspace, energy,
               estimated_time as "estimatedTime", tags, due_date as "dueDate",
               status, ai_confidence as "aiConfidence", created_at as "createdAt"`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Draft task not found');
  }

  const task = result.rows[0];
  return {
    ...task,
    tags: task.tags || [],
  };
};

/**
 * Delete a draft task
 */
export const deleteDraftTask = async (userId, draftId) => {
  const result = await query(
    'DELETE FROM draft_tasks WHERE id = $1 AND user_id = $2 RETURNING id',
    [draftId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Draft task not found');
  }

  return { success: true };
};

/**
 * Bulk approve draft tasks
 */
export const bulkApproveDraftTasks = async (userId, draftIds) => {
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    throw new Error('Invalid draft task IDs');
  }

  const results = [];
  for (const draftId of draftIds) {
    try {
      const result = await approveDraftTask(userId, draftId);
      results.push({ id: draftId, success: true, task: result.task });
    } catch (error) {
      results.push({ id: draftId, success: false, error: error.message });
    }
  }

  return { results };
};

/**
 * Bulk reject draft tasks
 */
export const bulkRejectDraftTasks = async (userId, draftIds) => {
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    throw new Error('Invalid draft task IDs');
  }

  const results = [];
  for (const draftId of draftIds) {
    try {
      const result = await query(
        'UPDATE draft_tasks SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
        ['rejected', draftId, userId]
      );
      if (result.rows.length === 0) {
        throw new Error('Draft task not found');
      }
      results.push({ id: draftId, success: true });
    } catch (error) {
      results.push({ id: draftId, success: false, error: error.message });
    }
  }

  return { results };
};
