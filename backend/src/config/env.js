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
  nodeEnv: process.env.NODE_ENV || 'development',
};
