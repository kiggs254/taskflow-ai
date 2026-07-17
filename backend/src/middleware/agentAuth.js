import { verifyApiToken } from '../services/apiTokenService.js';

/**
 * Authenticate a machine caller by API token.
 *
 * Deliberately separate from `authenticate`: this accepts ONLY `api_tokens` rows
 * with scope 'agent', and is mounted ONLY on /api/agent. A token that lives in a
 * shell profile on a laptop should not be able to read the user's tasks, change
 * settings, or touch their integrations — the blast radius is one endpoint.
 *
 * It also does not accept normal login tokens, so a leaked session token can't be
 * replayed here either.
 */
export const authenticateAgent = async (req, res, next) => {
  try {
    const header = req.headers.authorization || req.headers.Authorization;
    if (!header) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const match = header.match(/Bearer\s+(.+)/);
    if (!match) {
      return res.status(401).json({ error: 'Invalid authorization header format' });
    }

    const token = await verifyApiToken(match[1].trim());
    if (!token) {
      // Same response for malformed, unknown and revoked: don't help a prober
      // distinguish "wrong token" from "revoked token".
      return res.status(401).json({ error: 'Invalid or revoked API token' });
    }

    if (token.scope !== 'agent') {
      return res.status(403).json({ error: 'Token is not scoped for agent access' });
    }

    req.user = { id: token.userId };
    req.apiToken = { id: token.tokenId, scope: token.scope };
    next();
  } catch (error) {
    console.error('Agent auth error:', error.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};
