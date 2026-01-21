import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'API_SECRET',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0 && process.env.NODE_ENV !== 'development') {
  console.warn(`Warning: Missing environment variables: ${missingVars.join(', ')}`);
}

export const config = {
  database: {
    url: process.env.DATABASE_URL,
  },
  api: {
    secret: process.env.API_SECRET || 'TASKFLOW_SECRET_KEY_999',
    port: parseInt(process.env.PORT || '3000', 10),
  },
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    },
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
    fromName: process.env.SMTP_FROM_NAME || 'TaskFlow.AI',
  },
  frontend: {
    url: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
};
