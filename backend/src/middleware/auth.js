import { validateToken } from '../utils/token.js';

/**
 * Authentication middleware
 * Validates Bearer token and attaches userId to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const match = authHeader.match(/Bearer\s+(.+)/);
    if (!match) {
      return res.status(401).json({ error: 'Invalid authorization header format' });
    }
    
    const token = match[1];
    const userId = validateToken(token);
    
    // Attach userId to request object
    req.user = { id: userId };
    next();
  } catch (error) {
    if (error.message.includes('expired')) {
      return res.status(401).json({ error: 'Token Expired' });
    }
    if (error.message.includes('Invalid')) {
      return res.status(401).json({ error: 'Invalid Token' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
};
