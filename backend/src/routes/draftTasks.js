import express from 'express';
import {
  getDraftTasks,
  getDraftTask,
  approveDraftTask,
  rejectDraftTask,
  editDraftTask,
  deleteDraftTask,
  bulkApproveDraftTasks,
  bulkRejectDraftTasks,
} from '../services/draftTaskService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/draft-tasks
 * Get all draft tasks (pending approval)
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status = 'pending' } = req.query;
  const drafts = await getDraftTasks(req.user.id, status);
  res.json(drafts);
}));

/**
 * GET /api/draft-tasks/:id
 * Get a single draft task
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const draft = await getDraftTask(req.user.id, parseInt(req.params.id, 10));
  res.json(draft);
}));

/**
 * POST /api/draft-tasks/:id/approve
 * Approve and create task from draft
 */
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const { title, description, workspace, energy, estimatedTime, tags, dueDate } = req.body;
  
  const edits = {};
  if (title !== undefined) edits.title = title;
  if (description !== undefined) edits.description = description;
  if (workspace !== undefined) edits.workspace = workspace;
  if (energy !== undefined) edits.energy = energy;
  if (estimatedTime !== undefined) edits.estimatedTime = estimatedTime;
  if (tags !== undefined) edits.tags = tags;
  if (dueDate !== undefined) edits.dueDate = dueDate;

  const result = await approveDraftTask(req.user.id, parseInt(req.params.id, 10), edits);
  res.json(result);
}));

/**
 * POST /api/draft-tasks/:id/reject
 * Reject draft task
 */
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const result = await rejectDraftTask(req.user.id, parseInt(req.params.id, 10));
  res.json(result);
}));

/**
 * PUT /api/draft-tasks/:id
 * Edit draft task before approving
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { title, description, workspace, energy, estimatedTime, tags, dueDate } = req.body;
  
  const edits = {};
  if (title !== undefined) edits.title = title;
  if (description !== undefined) edits.description = description;
  if (workspace !== undefined) edits.workspace = workspace;
  if (energy !== undefined) edits.energy = energy;
  if (estimatedTime !== undefined) edits.estimatedTime = estimatedTime;
  if (tags !== undefined) edits.tags = tags;
  if (dueDate !== undefined) edits.dueDate = dueDate;

  const result = await editDraftTask(req.user.id, parseInt(req.params.id, 10), edits);
  res.json(result);
}));

/**
 * DELETE /api/draft-tasks/:id
 * Delete draft task
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await deleteDraftTask(req.user.id, parseInt(req.params.id, 10));
  res.json(result);
}));

/**
 * POST /api/draft-tasks/bulk-approve
 * Approve multiple draft tasks
 */
router.post('/bulk-approve', asyncHandler(async (req, res) => {
  const { draftIds } = req.body;
  
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    return res.status(400).json({ error: 'draftIds must be a non-empty array' });
  }

  const result = await bulkApproveDraftTasks(req.user.id, draftIds);
  res.json(result);
}));

/**
 * POST /api/draft-tasks/bulk-reject
 * Reject multiple draft tasks
 */
router.post('/bulk-reject', asyncHandler(async (req, res) => {
  const { draftIds } = req.body;
  
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    return res.status(400).json({ error: 'draftIds must be a non-empty array' });
  }

  const result = await bulkRejectDraftTasks(req.user.id, draftIds);
  res.json(result);
}));

export default router;
