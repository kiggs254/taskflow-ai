import crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment or generate a default
 * In production, ENCRYPTION_KEY should be a 32-byte hex string
 */
const getEncryptionKey = () => {
  const envKey = process.env.ENCRYPTION_KEY;
  
  if (envKey) {
    // If it's a hex string, convert to buffer
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    // Otherwise, derive key from string using PBKDF2
    return crypto.pbkdf2Sync(envKey, 'taskflow-salt', 100000, KEY_LENGTH, 'sha512');
  }
  
  // Fallback: use a default key (NOT SECURE for production)
  console.warn('WARNING: Using default encryption key. Set ENCRYPTION_KEY in production!');
  return crypto.pbkdf2Sync('default-key-change-in-production', 'taskflow-salt', 100000, KEY_LENGTH, 'sha512');
};

/**
 * Encrypt sensitive data (e.g., OAuth tokens)
 */
export const encrypt = (text) => {
  if (!text) return null;
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine iv + tag + encrypted data
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt sensitive data
 */
export const decrypt = (encryptedData) => {
  if (!encryptedData) return null;
  
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

/**
 * Generate a secure random encryption key (for initial setup)
 */
export const generateEncryptionKey = () => {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
};
