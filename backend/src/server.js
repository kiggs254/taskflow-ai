import express from 'express';
import { config } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import aiRoutes from './routes/ai.js';
import queryParamRoutes from './routes/queryParams.js';
import gmailRoutes from './routes/gmail.js';
import telegramRoutes from './routes/telegram.js';
import slackRoutes from './routes/slack.js';
import draftTasksRoutes from './routes/draftTasks.js';
import { initializeBot } from './services/telegramService.js';
import { startEmailScanner } from './jobs/emailScanner.js';
import { startSlackScanner } from './jobs/slackScanner.js';
import { startOverdueNotifier, startDailySummary } from './jobs/overdueNotifier.js';

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'TaskFlow API Online' });
});

// Mount specific routes FIRST (before query parameter routes)
// This ensures callbacks and webhooks don't get intercepted

// Gmail routes (callback doesn't require auth - routes handle auth individually)
app.use('/api/gmail', gmailRoutes);

// Telegram routes (webhook doesn't require auth)
app.use('/api/telegram', telegramRoutes);

// Slack routes (callback doesn't require auth - routes handle auth individually)
app.use('/api/slack', slackRoutes);

// AI routes (require authentication - already has authenticate in router)
app.use('/api/ai', aiRoutes);

// Draft tasks routes (require authentication)
app.use('/api/draft-tasks', authenticate, draftTasksRoutes);

// Auth routes (no authentication required)
app.use('/api', authRoutes);

// Handle query parameter routing BEFORE task routes (for auth routes like forgot_password)
// This ensures auth routes (register, login, forgot_password, reset_password) are handled first
// The queryParamRoutes will check for action parameter and call next() if not found
app.use('/api', queryParamRoutes);

// Task routes (already has authenticate middleware in the router)
// Must come AFTER queryParamRoutes so auth routes can be handled first
app.use('/api', taskRoutes);

// 404 handler for unmatched routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize Telegram bot (with error handling to prevent crashes)
// Wrap in setTimeout to prevent blocking server startup
setTimeout(() => {
  try {
    const botInstance = initializeBot();
    if (!botInstance) {
      console.warn('⚠️ Telegram bot not available - server will continue without it');
    }
  } catch (error) {
    console.error('Failed to initialize Telegram bot (non-critical):', error.message || error);
    // Don't crash the server if bot fails to initialize
  }
}, 2000); // Delay 2 seconds to let server start first

// Global error handlers for unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Start scheduled jobs
if (config.nodeEnv === 'production' || process.env.ENABLE_JOBS === 'true') {
  startEmailScanner();
  startSlackScanner();
  startOverdueNotifier();
  startDailySummary();
  console.log('Scheduled jobs started');
}

// Start server
const PORT = config.api.port;
app.listen(PORT, () => {
  console.log(`TaskFlow API server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});
