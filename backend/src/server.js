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

// Task routes (already has authenticate middleware in the router)
app.use('/api', taskRoutes);

// Handle query parameter routing LAST (for backward compatibility with PHP backend)
// This must come after specific routes to avoid intercepting callbacks/webhooks
// The queryParamRoutes will check for action parameter and call next() if not found
app.use('/api', queryParamRoutes);

// 404 handler for unmatched routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize Telegram bot (with error handling to prevent crashes)
// Wrap in setTimeout to prevent blocking server startup
setTimeout(() => {
  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:70',message:'server setTimeout - calling initializeBot',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const botInstance = initializeBot();
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:73',message:'server setTimeout - initializeBot returned',data:{hasBotInstance:!!botInstance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!botInstance) {
      console.warn('⚠️ Telegram bot not available - server will continue without it');
    }
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:77',message:'server setTimeout - initializeBot ERROR',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.error('Failed to initialize Telegram bot (non-critical):', error.message || error);
    // Don't crash the server if bot fails to initialize
  }
}, 2000); // Delay 2 seconds to let server start first

// Global error handlers for unhandled rejections and exceptions
// #region agent log
process.on('unhandledRejection', (reason, promise) => {
  fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:92',message:'unhandledRejection',data:{reason:String(reason),promise:String(promise)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:96',message:'uncaughtException',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  console.error('Uncaught Exception:', error);
});
// #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7245/ingest/2bf9f9ad-65fb-4474-8fe6-6f000c106851',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server.js:110',message:'server STARTED',data:{port:PORT,env:config.nodeEnv},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.log(`TaskFlow API server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});
