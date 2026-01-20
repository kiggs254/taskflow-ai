import express from 'express';
import {
  getUserTasks,
  syncTask,
  deleteTask,
  completeTask,
  uncompleteTask,
} from '../services/taskService.js';
import { updateUserXP, updateDailyReset } from '../services/userService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// All task routes require authentication
router.use(authenticate);

/**
 * GET /api?action=get_tasks
 * Get all tasks for the authenticated user
 */
router.get('/get_tasks', asyncHandler(async (req, res) => {
  const tasks = await getUserTasks(req.user.id);
  res.json(tasks);
}));

/**
 * POST /api?action=sync_tasks
 * Create or update a task
 */
router.post('/sync_tasks', asyncHandler(async (req, res) => {
  const result = await syncTask(req.user.id, req.body);
  res.json(result);
}));

/**
 * POST /api?action=delete_task
 * Delete a task
 */
router.post('/delete_task', asyncHandler(async (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Task id is required' });
  }

  const result = await deleteTask(req.user.id, id);
  res.json(result);
}));

/**
 * POST /api?action=complete_task
 * Mark a task as complete and update XP
 */
router.post('/complete_task', asyncHandler(async (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Task id is required' });
  }

  await completeTask(req.user.id, id);
  const xpResult = await updateUserXP(req.user.id, 50);

  res.json({
    success: true,
    ...xpResult,
  });
}));

/**
 * POST /api?action=uncomplete_task
 * Mark a task as incomplete
 */
router.post('/uncomplete_task', asyncHandler(async (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Task id is required' });
  }

  const result = await uncompleteTask(req.user.id, id);
  res.json(result);
}));

/**
 * POST /api?action=daily_reset
 * Update the daily reset timestamp
 */
router.post('/daily_reset', asyncHandler(async (req, res) => {
  const result = await updateDailyReset(req.user.id);
  res.json(result);
}));

export default router;
