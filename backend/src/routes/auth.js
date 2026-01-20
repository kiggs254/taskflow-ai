import express from 'express';
import { registerUser, loginUser } from '../services/userService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api?action=register
 * Register a new user
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const result = await registerUser(username, email, password);
    res.json(result);
  } catch (error) {
    if (error.message === 'User already exists') {
      return res.status(400).json({ error: 'User already exists' });
    }
    throw error;
  }
}));

/**
 * POST /api?action=login
 * Login user
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const result = await loginUser(email, password);
    res.json(result);
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    throw error;
  }
}));

export default router;
