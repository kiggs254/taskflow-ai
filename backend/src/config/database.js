import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

// Determine SSL configuration
// Allow SSL to be disabled via environment variable or detect from connection string
const getSSLConfig = () => {
  // Check if SSL is explicitly disabled
  if (process.env.DATABASE_SSL === 'false' || process.env.DATABASE_SSL === '0') {
    return false;
  }
  
  // Check if SSL is explicitly enabled
  if (process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1') {
    return { rejectUnauthorized: false };
  }
  
  // Auto-detect: localhost typically doesn't need SSL
  if (config.database.url?.includes('localhost') || config.database.url?.includes('127.0.0.1')) {
    return false;
  }
  
  // For remote databases, try SSL but allow fallback
  // If the connection string has sslmode parameter, respect it
  if (config.database.url?.includes('sslmode=require')) {
    return { rejectUnauthorized: false };
  }
  
  if (config.database.url?.includes('sslmode=disable')) {
    return false;
  }
  
  // Default: try without SSL first (most databases don't require it)
  return false;
};

// Create connection pool
export const pool = new Pool({
  connectionString: config.database.url,
  ssl: getSSLConfig(),
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
});

// Test connection
pool.on('connect', () => {
  console.log('Database connected');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to execute queries
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error', { text, error: error.message });
    throw error;
  }
};

// Helper function to get a client from the pool for transactions
export const getClient = async () => {
  const client = await pool.connect();
  const query = client.query.bind(client);
  const release = client.release.bind(client);
  
  // Set a timeout of 5 seconds, after which we will log this client's last query
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);
  
  // Monkey patch the query method to log the query when a client is checked out
  client.query = (...args) => {
    client.lastQuery = args;
    return query(...args);
  };
  
  client.release = () => {
    clearTimeout(timeout);
    client.query = query;
    client.release = release;
    return release();
  };
  
  return client;
};
