import express from 'express';
import { registerUser, loginUser } from '../services/userService.js';
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

// Handle query parameter routing for backward compatibility
// These routes handle ?action= parameter

// Auth routes
router.post('/', asyncHandler(async (req, res) => {
  const action = req.query.action;
  
  if (action === 'register') {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    try {
      const result = await registerUser(username, email, password);
      return res.json(result);
    } catch (error) {
      if (error.message === 'User already exists') {
        return res.status(400).json({ error: 'User already exists' });
      }
      throw error;
    }
  } else if (action === 'login') {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    try {
      const result = await loginUser(email, password);
      return res.json(result);
    } catch (error) {
      if (error.message === 'User not found') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (error.message === 'Invalid credentials') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      throw error;
    }
  }
  
  // If action doesn't match, continue to next middleware (don't return 404 here)
  // This allows direct routes to handle the request
  return next();
}));

// Task routes (require authentication)
router.get('/', authenticate, asyncHandler(async (req, res) => {
  if (req.query.action === 'get_tasks') {
    const tasks = await getUserTasks(req.user.id);
    return res.json(tasks);
  }
  // If action doesn't match, continue to next middleware
  return next();
}));

router.post('/', authenticate, asyncHandler(async (req, res) => {
  const action = req.query.action;
  
  if (action === 'sync_tasks') {
    const result = await syncTask(req.user.id, req.body);
    return res.json(result);
  } else if (action === 'delete_task') {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Task id is required' });
    }
    const result = await deleteTask(req.user.id, id);
    return res.json(result);
  } else if (action === 'complete_task') {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Task id is required' });
    }
    await completeTask(req.user.id, id);
    const xpResult = await updateUserXP(req.user.id, 50);
    return res.json({
      success: true,
      ...xpResult,
    });
  } else if (action === 'uncomplete_task') {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Task id is required' });
    }
    const result = await uncompleteTask(req.user.id, id);
    return res.json(result);
  } else if (action === 'daily_reset') {
    const result = await updateDailyReset(req.user.id);
    return res.json(result);
  }
  
  // If action doesn't match, continue to next middleware
  return next();
}));

export default router;
