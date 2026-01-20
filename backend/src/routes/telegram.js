import express from 'express';
import {
  getTelegramStatus,
  unlinkTelegramAccount,
  updateTelegramSettings,
  generateLinkingCode,
  getBot,
} from '../services/telegramService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/telegram/webhook
 * Webhook endpoint for Telegram (if using webhook instead of polling)
 */
router.post('/webhook', express.json(), asyncHandler(async (req, res) => {
  const bot = getBot();
  
  if (!bot) {
    return res.status(503).json({ error: 'Telegram bot not initialized' });
  }

  // Process webhook update
  bot.processUpdate(req.body);
  res.sendStatus(200);
}));

/**
 * GET /api/telegram/webhook
 * Set webhook URL (for initial setup)
 */
router.get('/webhook', asyncHandler(async (req, res) => {
  const bot = getBot();
  
  if (!bot) {
    return res.status(503).json({ error: 'Telegram bot not initialized' });
  }

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  
  if (!webhookUrl) {
    return res.status(400).json({ error: 'TELEGRAM_WEBHOOK_URL not configured' });
  }

  try {
    await bot.setWebHook(webhookUrl);
    res.json({ success: true, webhookUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));

/**
 * GET /api/telegram/link-code
 * Generate linking code for user
 */
router.get('/link-code', authenticate, asyncHandler(async (req, res) => {
  const code = await generateLinkingCode(req.user.id);
  res.json({ code });
}));

/**
 * GET /api/telegram/status
 * Get Telegram connection status
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getTelegramStatus(req.user.id);
  res.json(status);
}));

/**
 * PUT /api/telegram/settings
 * Update Telegram settings
 */
router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const { notificationsEnabled, dailySummaryTime } = req.body;
  
  const settings = {};
  if (notificationsEnabled !== undefined) {
    settings.notificationsEnabled = Boolean(notificationsEnabled);
  }
  if (dailySummaryTime !== undefined) {
    settings.dailySummaryTime = dailySummaryTime;
  }

  const result = await updateTelegramSettings(req.user.id, settings);
  res.json(result);
}));

/**
 * POST /api/telegram/unlink
 * Unlink Telegram account
 */
router.post('/unlink', authenticate, asyncHandler(async (req, res) => {
  const result = await unlinkTelegramAccount(req.user.id);
  res.json(result);
}));

export default router;
