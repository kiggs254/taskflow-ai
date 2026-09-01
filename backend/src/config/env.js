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
    // Moonshot (Kimi). OpenAI-compatible. Its thinking models default to thinking ON,
    // and the chain-of-thought is billed against max_tokens -- so callAI sends
    // thinking:{type:'disabled'} for the JSON tasks here (see CAPS.moonshot).
    moonshot: {
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
    },
    // Xiaomi MiMo. OpenAI-compatible.
    mimo: {
      apiKey: process.env.MIMO_API_KEY,
      baseURL: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1',
    },
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  // Live agent console. `POST /control/message` on the agent is arbitrary shell
  // across every client repo, so this is deliberately process-wide env rather
  // than per-user DB rows: there is one agent fleet per deployment, and a
  // fleet-RCE credential does not belong in a settings form.
  //
  // CONSOLE_USER_IDS is an allowlist, and empty means nobody. The console is
  // off until someone is named, which is the safe default for a feature whose
  // failure mode is handing out a shell.
  agentConsole: {
    url: process.env.AGENT_URL || '',
    // Hermes' capability service. Only its unauthenticated /health is used, to
    // answer "is Hermes actually up?" rather than inferring it from whether a
    // Hermes call happens to be running.
    capsvcUrl: process.env.CAPSVC_URL || '',
    token: process.env.AGENT_CONTROL_TOKEN || '',
    userIds: (process.env.CONSOLE_USER_IDS || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter(Number.isInteger),
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
