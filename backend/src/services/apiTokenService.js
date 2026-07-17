import crypto from 'crypto';
import { query } from '../config/database.js';

/**
 * Long-lived API tokens for machines (the Claude Code hook).
 *
 * Not reusing utils/token.js: that's a stateless 7-day HMAC with no scope claim, so
 * a hook using one would break silently every week, and a long-lived variant would
 * be unscoped, unrevocable full-account access sitting in a shell profile.
 *
 * Here the token is a random secret; only its sha256 is stored, so a database leak
 * yields nothing usable. Scope is checked at the middleware, and `revoked_at` gives
 * a real kill switch.
 */

const PREFIX = 'tf_';

export const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Mint a token. The raw value is returned exactly once and never stored.
 */
export const createApiToken = async (userId, name = 'CLI', scope = 'agent') => {
  const raw = `${PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  const result = await query(
    `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, prefix, scope, created_at`,
    [userId, name.slice(0, 100), hashToken(raw), raw.slice(0, 11), scope]
  );
  // `token` is present in this response only. There is no way to read it back.
  return { ...result.rows[0], token: raw };
};

export const listApiTokens = async (userId) => {
  const result = await query(
    `SELECT id, name, prefix, scope, last_used_at AS "lastUsedAt", created_at AS "createdAt"
     FROM api_tokens
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
};

export const revokeApiToken = async (userId, tokenId) => {
  const result = await query(
    `UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [tokenId, userId]
  );
  return result.rows.length > 0;
};

/**
 * Resolve a raw token to { userId, tokenId, scope }, or null.
 *
 * Looks up by hash, so the raw value is never compared in the database and a
 * timing-safe compare isn't needed: an index lookup on a sha256 either hits or it
 * doesn't, and the hash of a guess reveals nothing about a stored one.
 */
export const verifyApiToken = async (raw) => {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null;

  const result = await query(
    `SELECT id, user_id, scope FROM api_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(raw)]
  );

  const row = result.rows[0];
  if (!row) return null;

  // Fire-and-forget: last_used_at is for the user's benefit ("is this token still in
  // use?"), and must never fail or slow an authenticated request.
  query('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id])
    .catch(() => {});

  return { userId: row.user_id, tokenId: row.id, scope: row.scope };
};
