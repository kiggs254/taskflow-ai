import express from 'express';
import {
  parseTask,
  getDailyMotivation,
  generateDailyPlan,
  generateClientFollowUp,
} from '../services/aiService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// All AI routes require authentication
router.use(authenticate);

/**
 * POST /api/ai/parse-task
 * Parse task input using AI
 * Body: { input: string, provider?: 'openai' | 'deepseek' }
 */
router.post('/parse-task', asyncHandler(async (req, res) => {
  const { input, provider = 'openai' } = req.body;

  if (!input) {
    return res.status(400).json({ error: 'Input is required' });
  }

  try {
    const result = await parseTask(input, provider);
    res.json(result);
  } catch (error) {
    console.error('Parse task error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse task' });
  }
}));

/**
 * POST /api/ai/daily-motivation
 * Get daily motivation message
 * Body: { completedTasks: number, pendingTasks: number, provider?: 'openai' | 'deepseek' }
 */
router.post('/daily-motivation', asyncHandler(async (req, res) => {
  const {
    completedTasks = 0,
    pendingTasks = 0,
    provider = 'openai',
  } = req.body;

  try {
    const message = await getDailyMotivation(
      completedTasks,
      pendingTasks,
      provider
    );
    res.json({ message });
  } catch (error) {
    console.error('Daily motivation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate motivation' });
  }
}));

/**
 * POST /api/ai/daily-plan
 * Generate daily plan based on pending tasks
 * Body: { pendingTasks: Task[], provider?: 'openai' | 'deepseek' }
 */
router.post('/daily-plan', asyncHandler(async (req, res) => {
  const { pendingTasks = [], provider = 'openai' } = req.body;

  if (!Array.isArray(pendingTasks)) {
    return res.status(400).json({ error: 'pendingTasks must be an array' });
  }

  try {
    const plan = await generateDailyPlan(pendingTasks, provider);
    res.json({ plan });
  } catch (error) {
    console.error('Daily plan error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate plan' });
  }
}));

/**
 * POST /api/ai/client-followup
 * Generate client follow-up message
 * Body: { taskTitle: string, provider?: 'openai' | 'deepseek' }
 */
router.post('/client-followup', asyncHandler(async (req, res) => {
  const { taskTitle, provider = 'openai' } = req.body;

  if (!taskTitle) {
    return res.status(400).json({ error: 'taskTitle is required' });
  }

  try {
    const message = await generateClientFollowUp(taskTitle, provider);
    res.json({ message });
  } catch (error) {
    console.error('Client followup error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate follow-up' });
  }
}));

export default router;
