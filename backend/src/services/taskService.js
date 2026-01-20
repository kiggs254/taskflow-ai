import { query } from '../config/database.js';

/**
 * Get all tasks for a user
 */
export const getUserTasks = async (userId) => {
  const result = await query(
    `SELECT id, user_id, title, description, workspace, energy, status, estimated_time as "estimatedTime",
            tags, dependencies, recurrence, created_at as "createdAt",
            completed_at as "completedAt", due_date as "dueDate",
            snoozed_until as "snoozedUntil", original_recurrence_id as "originalRecurrenceId"
     FROM tasks
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map((task) => ({
    ...task,
    tags: task.tags || [],
    dependencies: task.dependencies || [],
  }));
};

/**
 * Sync (create or update) a task
 */
export const syncTask = async (userId, taskData) => {
  const {
    id,
    title,
    description,
    workspace,
    energy,
    status,
    estimatedTime,
    tags = [],
    dependencies = [],
    createdAt,
    completedAt,
    dueDate,
    snoozedUntil,
    recurrence,
    originalRecurrenceId,
  } = taskData;

  // Validate required fields
  if (!id || !title) {
    throw new Error('Task id and title are required');
  }

  const result = await query(
    `INSERT INTO tasks (
      id, user_id, title, description, workspace, energy, status, estimated_time,
      tags, dependencies, recurrence, created_at, completed_at,
      due_date, snoozed_until, original_recurrence_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      workspace = EXCLUDED.workspace,
      energy = EXCLUDED.energy,
      status = EXCLUDED.status,
      estimated_time = EXCLUDED.estimated_time,
      tags = EXCLUDED.tags,
      dependencies = EXCLUDED.dependencies,
      completed_at = EXCLUDED.completed_at,
      due_date = EXCLUDED.due_date,
      snoozed_until = EXCLUDED.snoozed_until,
      recurrence = EXCLUDED.recurrence
    RETURNING id`,
    [
      id,
      userId,
      title,
      description || null,
      workspace,
      energy,
      status,
      estimatedTime || null,
      JSON.stringify(tags),
      JSON.stringify(dependencies),
      recurrence ? JSON.stringify(recurrence) : null,
      createdAt,
      completedAt || null,
      dueDate || null,
      snoozedUntil || null,
      originalRecurrenceId || null,
    ]
  );

  return { success: true };
};

/**
 * Delete a task
 */
export const deleteTask = async (userId, taskId) => {
  const result = await query(
    'DELETE FROM tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );

  return { success: true };
};

/**
 * Complete a task
 */
export const completeTask = async (userId, taskId) => {
  const now = Date.now();

  // Update task status
  await query(
    'UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3 AND user_id = $4',
    ['done', now, taskId, userId]
  );

  return { success: true };
};

/**
 * Uncomplete a task
 */
export const uncompleteTask = async (userId, taskId) => {
  await query(
    'UPDATE tasks SET status = $1, completed_at = NULL WHERE id = $2 AND user_id = $3',
    ['todo', taskId, userId]
  );

  return { success: true };
};
