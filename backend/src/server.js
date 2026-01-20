import express from 'express';
import { config } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import aiRoutes from './routes/ai.js';
import { authenticate } from './middleware/auth.js';

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'TaskFlow API Online' });
});

// Middleware to handle query parameter routing (for backward compatibility with PHP backend)
app.use((req, res, next) => {
  const action = req.query.action;

  if (action) {
    // Rewrite URL based on action parameter for backward compatibility
    // Routes are mounted at /api, so we rewrite to /api/{action}
    if (action === 'register' && req.method === 'POST') {
      req.url = '/register';
      req.path = '/register';
    } else if (action === 'login' && req.method === 'POST') {
      req.url = '/login';
      req.path = '/login';
    } else if (action === 'get_tasks' && req.method === 'GET') {
      req.url = '/get_tasks';
      req.path = '/get_tasks';
    } else if (action === 'sync_tasks' && req.method === 'POST') {
      req.url = '/sync_tasks';
      req.path = '/sync_tasks';
    } else if (action === 'delete_task' && req.method === 'POST') {
      req.url = '/delete_task';
      req.path = '/delete_task';
    } else if (action === 'complete_task' && req.method === 'POST') {
      req.url = '/complete_task';
      req.path = '/complete_task';
    } else if (action === 'uncomplete_task' && req.method === 'POST') {
      req.url = '/uncomplete_task';
      req.path = '/uncomplete_task';
    } else if (action === 'daily_reset' && req.method === 'POST') {
      req.url = '/daily_reset';
      req.path = '/daily_reset';
    }
  }

  next();
});

// Mount routes
// Auth routes (no authentication required)
app.use('/api', authRoutes);

// Task routes (already has authenticate middleware in the router)
app.use('/api', taskRoutes);

// AI routes (require authentication)
app.use('/api/ai', authenticate, aiRoutes);

// Error handler (must be last)
app.use(errorHandler);

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
