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
import draftTasksRoutes from './routes/draftTasks.js';
import { initializeBot } from './services/telegramService.js';
import { startEmailScanner } from './jobs/emailScanner.js';
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

// Handle query parameter routing first (for backward compatibility with PHP backend)
// This must come before the direct routes to catch ?action= requests
// The queryParamRoutes will check for action parameter and call next() if not found
app.use('/api', queryParamRoutes);

// Mount routes for direct access (without query parameters)
// Auth routes (no authentication required)
app.use('/api', authRoutes);

// Task routes (already has authenticate middleware in the router)
app.use('/api', taskRoutes);

// AI routes (require authentication - already has authenticate in router)
app.use('/api/ai', aiRoutes);

// Gmail routes (require authentication - routes handle auth individually)
app.use('/api/gmail', gmailRoutes);

// Telegram routes
app.use('/api/telegram', telegramRoutes);

// Draft tasks routes (require authentication)
app.use('/api/draft-tasks', authenticate, draftTasksRoutes);

// 404 handler for unmatched routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize Telegram bot
initializeBot();

// Start scheduled jobs
if (config.nodeEnv === 'production' || process.env.ENABLE_JOBS === 'true') {
  startEmailScanner();
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
