import express from 'express';
import { config } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import aiRoutes from './routes/ai.js';
import queryParamRoutes from './routes/queryParams.js';

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
// This must come before the direct routes
app.use('/api', queryParamRoutes);

// Mount routes for direct access (without query parameters)
// Auth routes (no authentication required)
app.use('/api', authRoutes);

// Task routes (already has authenticate middleware in the router)
app.use('/api', taskRoutes);

// AI routes (require authentication - already has authenticate in router)
app.use('/api/ai', aiRoutes);

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
