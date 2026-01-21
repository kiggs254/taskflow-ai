import express from 'express';
import fs from 'fs';
import { registerUser, loginUser } from '../services/userService.js';
import {
  getUserTasks,
  syncTask,
  deleteTask,
  completeTask,
  uncompleteTask,
} from '../services/taskService.js';
import { updateUserXP, updateDailyReset, getUserPreferences, updateUserPreferences, requestPasswordReset, resetPassword } from '../services/userService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Handle query parameter routing for backward compatibility
// These routes handle ?action= parameter

// Auth routes (NO authentication required)
router.post('/', asyncHandler(async (req, res, next) => {
  // #region agent log
  const fs = require('fs');
  const logPath = '/Users/mac/Desktop/Projects/taskflow.ai (5)/.cursor/debug.log';
  const logEntry = JSON.stringify({location:'queryParams.js:20',message:'queryParams POST route entered',data:{action:req.query.action,hasAuthHeader:!!req.headers.authorization,method:req.method,path:req.path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n';
  fs.appendFileSync(logPath, logEntry);
  // #endregion
  const action = req.query.action;
  
  // Debug logging
  console.log('=== QUERY PARAMS ROUTE ===');
  console.log('Action:', action);
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Query:', req.query);
  console.log('Body keys:', Object.keys(req.body || {}));
  
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
    console.log('=== LOGIN REQUEST ===');
    const { email, password } = req.body;
    console.log('Email provided:', email ? 'Yes' : 'No');
    console.log('Password provided:', password ? 'Yes' : 'No');
    
    if (!email || !password) {
      console.log('Missing fields - returning 400');
      return res.status(400).json({ error: 'Missing fields' });
    }
    try {
      console.log('Calling loginUser...');
      const result = await loginUser(email, password);
      console.log('Login successful for:', email);
      return res.json(result);
    } catch (error) {
      // Enhanced logging for debugging
      console.error('=== LOGIN ERROR ===');
      console.error('Email:', email);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      if (error.message === 'User not found') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (error.message === 'Invalid credentials') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      console.error('Unexpected login error:', error);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  } else if (action === 'forgot_password') {
    // #region agent log
    const logPath = '/Users/mac/Desktop/Projects/taskflow.ai (5)/.cursor/debug.log';
    const logEntry = JSON.stringify({location:'queryParams.js:76',message:'forgot_password route handler entered',data:{hasEmail:!!req.body.email,hasAuthHeader:!!req.headers.authorization,method:req.method,path:req.path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n';
    fs.appendFileSync(logPath, logEntry);
    // #endregion
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    try {
      const result = await requestPasswordReset(email);
      // #region agent log
      const logEntry2 = JSON.stringify({location:'queryParams.js:83',message:'forgot_password success',data:{success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n';
      fs.appendFileSync(logPath, logEntry2);
      // #endregion
      return res.json(result);
    } catch (error) {
      // #region agent log
      const logEntry3 = JSON.stringify({location:'queryParams.js:86',message:'forgot_password error',data:{error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n';
      fs.appendFileSync(logPath, logEntry3);
      // #endregion
      console.error('Forgot password error:', error.message);
      return res.status(500).json({ error: error.message || 'Failed to process password reset request' });
    }
  } else if (action === 'reset_password') {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    try {
      const result = await resetPassword(token, password);
      return res.json(result);
    } catch (error) {
      console.error('Reset password error:', error.message);
      if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('used')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message || 'Failed to reset password' });
    }
  }
  
  // If action doesn't match, continue to next middleware (don't return 404 here)
  // This allows direct routes to handle the request
  console.log('Action not matched, calling next()');
  return next();
}));

// Task routes (require authentication)
// Only handle if action parameter exists, otherwise skip
router.get('/', authenticate, asyncHandler(async (req, res, next) => {
  if (req.query.action === 'get_tasks') {
    const tasks = await getUserTasks(req.user.id);
    return res.json(tasks);
  }
  // If action doesn't match, continue to next middleware
  // This allows other routes to handle the request
  return next();
}));

router.post('/', authenticate, asyncHandler(async (req, res, next) => {
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
    const { id, sendEmailReply } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Task id is required' });
    }
    await completeTask(req.user.id, id, { sendEmailReply: Boolean(sendEmailReply) });
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
  } else if (action === 'get_user_preferences') {
    const preferences = await getUserPreferences(req.user.id);
    return res.json(preferences);
  } else if (action === 'update_user_preferences') {
    const result = await updateUserPreferences(req.user.id, req.body);
    return res.json(result);
  }
  
  // If action doesn't match, continue to next middleware
  return next();
}));

export default router;
