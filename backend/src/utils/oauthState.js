import crypto from 'crypto';
import { config } from '../config/env.js';

/**
 * Signed OAuth `state` parameter.
 *
 * Previously every integration passed the bare user id as `state` and read it
 * back with parseInt. That let anyone complete an OAuth flow against someone
 * else's account by editing one query param (`?code=<theirs>&state=<victim>`),
 * binding their inbox/workspace to the victim's TaskFlow account. Read-only
 * Gmail scope made that bad; a GitHub token makes it worse.
 *
 * Format: base64url(payload).base64url(hmac_sha256(payload))
 * Payload: { uid, provider, nonce, exp }
 *
 * Stateless by design — the HMAC plus a short expiry is sufficient for CSRF
 * here, so no nonce table is needed. `provider` is bound into the signature so
 * a state minted for one provider cannot be replayed against another's callback.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes: generous for a login+consent screen.

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const sign = (payloadB64) =>
  crypto.createHmac('sha256', config.api.secret).update(payloadB64).digest();

/**
 * Mint a signed state for `userId` starting an OAuth flow with `provider`.
 */
export const signState = (userId, provider) => {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('signState requires a positive integer userId');
  }
  if (!provider || typeof provider !== 'string') {
    throw new Error('signState requires a provider');
  }

  const payload = JSON.stringify({
    uid: userId,
    provider,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + TTL_MS,
  });

  const payloadB64 = b64url(payload);
  return `${payloadB64}.${b64url(sign(payloadB64))}`;
};

/**
 * Verify a state string and return the user id it was minted for.
 * Throws on any tampering, expiry, or provider mismatch.
 */
export const verifyState = (state, expectedProvider) => {
  if (typeof state !== 'string' || !state.includes('.')) {
    throw new Error('Invalid OAuth state format');
  }

  const [payloadB64, sigB64] = state.split('.');
  if (!payloadB64 || !sigB64) {
    throw new Error('Invalid OAuth state format');
  }

  const expected = sign(payloadB64);
  const provided = Buffer.from(sigB64, 'base64url');

  // timingSafeEqual throws on length mismatch, so gate on length first.
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new Error('Invalid OAuth state signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('Invalid OAuth state payload');
  }

  if (payload.provider !== expectedProvider) {
    throw new Error('OAuth state provider mismatch');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    throw new Error('OAuth state expired');
  }
  if (!Number.isInteger(payload.uid) || payload.uid <= 0) {
    throw new Error('Invalid OAuth state user');
  }

  return payload.uid;
};
