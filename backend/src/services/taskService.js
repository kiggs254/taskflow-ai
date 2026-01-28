import { query } from '../config/database.js';

/**
 * Get all tasks for a user
 */
export const getUserTasks = async (userId) => {
  const result = await query(
    `SELECT id, user_id, title, description, workspace, energy, status, estimated_time as "estimatedTime",
            tags, dependencies, subtasks, recurrence, created_at as "createdAt",
            completed_at as "completedAt", due_date as "dueDate",
            snoozed_until as "snoozedUntil", original_recurrence_id as "originalRecurrenceId",
            meeting_link as "meetingLink"
     FROM tasks
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map((task) => ({
    ...task,
    tags: task.tags || [],
    dependencies: task.dependencies || [],
    subtasks: task.subtasks || [],
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
    subtasks = [],
    createdAt,
    completedAt,
    dueDate,
    snoozedUntil,
    recurrence,
    originalRecurrenceId,
    meetingLink,
  } = taskData;

  // Validate required fields
  if (!id || !title) {
    throw new Error('Task id and title are required');
  }

  const result = await query(
    `INSERT INTO tasks (
      id, user_id, title, description, workspace, energy, status, estimated_time,
      tags, dependencies, subtasks, recurrence, created_at, completed_at,
      due_date, snoozed_until, original_recurrence_id, meeting_link
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      workspace = EXCLUDED.workspace,
      energy = EXCLUDED.energy,
      status = EXCLUDED.status,
      estimated_time = EXCLUDED.estimated_time,
      tags = EXCLUDED.tags,
      dependencies = EXCLUDED.dependencies,
      subtasks = EXCLUDED.subtasks,
      completed_at = EXCLUDED.completed_at,
      due_date = EXCLUDED.due_date,
      snoozed_until = EXCLUDED.snoozed_until,
      recurrence = EXCLUDED.recurrence,
      meeting_link = EXCLUDED.meeting_link
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
      JSON.stringify(subtasks),
      recurrence ? JSON.stringify(recurrence) : null,
      createdAt,
      completedAt || null,
      dueDate || null,
      snoozedUntil || null,
      originalRecurrenceId || null,
      meetingLink || null,
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
export const completeTask = async (userId, taskId, options = {}) => {
  const { sendEmailReply = false } = options;
  const now = Date.now();

  // Get task details before updating (to check if it's a Slack or Gmail task)
  const taskResult = await query(
    'SELECT title, description, tags FROM tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );

  if (taskResult.rows.length === 0) {
    throw new Error('Task not found');
  }

  const task = taskResult.rows[0];
  // Tags are stored as JSONB, parse if needed
  let tags = task.tags || [];
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }
  const isSlackTask = Array.isArray(tags) && tags.includes('slack');
  const isGmailTask = Array.isArray(tags) && tags.includes('gmail');

  // Update task status
  await query(
    'UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3 AND user_id = $4',
    ['done', now, taskId, userId]
  );

  // If it's a Slack task, reply to the original message
  if (isSlackTask && task.description) {
    try {
      const { replyToSlackTask } = await import('./slackService.js');
      await replyToSlackTask(userId, task.title, task.description);
    } catch (error) {
      console.error('Error replying to Slack task:', error);
      // Don't fail task completion if Slack reply fails
    }
  }

  // If it's a Gmail task and user wants to send auto-reply
  if (isGmailTask && sendEmailReply && task.description) {
    try {
      const { generateEmailCompletionReply } = await import('./aiService.js');
      const { replyToEmail } = await import('./gmailService.js');
      
      // Get user's name for sign-off
      const userResult = await query('SELECT username FROM users WHERE id = $1', [userId]);
      const userName = userResult.rows[0]?.username || '';
      
      // Generate completion reply with user's name
      const replyMessage = await generateEmailCompletionReply(
        task.title,
        task.description,
        'openai',
        userName
      );
      
      // Send the reply
      await replyToEmail(userId, taskId, replyMessage, false, '');
    } catch (error) {
      console.error('Error sending Gmail auto-reply:', error);
      // Don't fail task completion if email reply fails
    }
  }

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
