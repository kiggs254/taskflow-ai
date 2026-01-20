import crypto from 'crypto';
import { config } from '../config/env.js';

/**
 * Generate a token for a user (matching PHP implementation)
 * Format: base64(hash|payload)
 * Payload: { uid: userId, exp: expirationTimestamp }
 */
export const generateToken = (userId) => {
  const payload = JSON.stringify({
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + (86400 * 7), // 7 days
  });
  
  const hash = crypto
    .createHmac('sha256', config.api.secret)
    .update(payload)
    .digest('hex');
  
  const token = `${hash}|${payload}`;
  return Buffer.from(token).toString('base64');
};

/**
 * Validate and decode a token
 * Returns userId if valid, throws error if invalid
 */
export const validateToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split('|');
    
    if (parts.length !== 2) {
      throw new Error('Invalid token format');
    }
    
    const [hash, payloadStr] = parts;
    
    // Verify hash
    const expectedHash = crypto
      .createHmac('sha256', config.api.secret)
      .update(payloadStr)
      .digest('hex');
    
    if (hash !== expectedHash) {
      throw new Error('Invalid token signature');
    }
    
    // Parse payload
    const payload = JSON.parse(payloadStr);
    
    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }
    
    return payload.uid;
  } catch (error) {
    throw new Error(`Token validation failed: ${error.message}`);
  }
};
