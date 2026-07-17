import crypto from 'crypto';
import { query } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';
import { signState } from '../utils/oauthState.js';

/**
 * GitHub auth + a thin HTTP client.
 *
 * All token acquisition is isolated here so githubService.js never knows whether it
 * is talking to a GitHub App installation or a classic OAuth app.
 *
 * We use a **GitHub App** rather than a classic OAuth app: a classic OAuth app
 * cannot read private repos without the `repo` scope, which grants read *and write*
 * to every private repo the user owns. A GitHub App gets `Contents: Read-only`, its
 * install screen doubles as the repo picker, and installation tokens get a higher
 * rate limit. A task manager should not hold write access to your source code.
 *
 * No @octokit/rest dependency: we need three endpoints. `slackService` already
 * hand-builds its OAuth URL, so this matches the house style.
 */

const API = 'https://api.github.com';
const UA = 'TaskFlow.AI';

const appId = () => process.env.GITHUB_APP_ID;
const appSlug = () => process.env.GITHUB_APP_SLUG;
const privateKey = () =>
  // Coolify env vars can't hold raw newlines; accept the common \n-escaped form.
  (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');

export const isGithubConfigured = () => Boolean(appId() && privateKey() && appSlug());

const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * App-level JWT (RS256), used only to mint installation tokens.
 * Hand-rolled rather than pulling in `jsonwebtoken` for one 3-field payload.
 */
const appJwt = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      // Backdate to tolerate clock skew between us and GitHub; GitHub rejects
      // future-dated iat outright.
      iat: now - 60,
      exp: now + 9 * 60, // GitHub caps app JWTs at 10 minutes
      iss: appId(),
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privateKey(), 'base64url');
  return `${header}.${payload}.${sig}`;
};

/**
 * Where the user goes to connect. GitHub's installation screen *is* the repo
 * picker, so repo selection is enforced by GitHub rather than trusted from our UI.
 */
export const getAuthUrl = (userId) =>
  `https://github.com/apps/${appSlug()}/installations/new?state=${encodeURIComponent(
    signState(userId, 'github')
  )}`;

// Installation tokens live ~1h. Cache per installation and refresh early.
const tokenCache = new Map();

const mintInstallationToken = async (installationId) => {
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub: failed to mint installation token (${res.status}): ${await res.text()}`);
  }

  const body = await res.json();
  const expiresAt = Date.parse(body.expires_at);
  tokenCache.set(installationId, { token: body.token, expiresAt });
  return body.token;
};

const installationToken = async (installationId) => {
  const cached = tokenCache.get(installationId);
  // 60s of headroom so a token can't expire mid-scan.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  return mintInstallationToken(installationId);
};

/**
 * Resolve the right bearer token for a user, whichever auth kind they connected with.
 */
const tokenForUser = async (userId) => {
  const result = await query(
    `SELECT auth_kind, installation_id, access_token
     FROM github_integrations WHERE user_id = $1 AND enabled = true`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;

  if (row.auth_kind === 'oauth_app') {
    return row.access_token ? decrypt(row.access_token) : null;
  }
  if (!row.installation_id) return null;
  return installationToken(row.installation_id);
};

/**
 * Minimal GitHub client scoped to one user.
 *
 * Centralises the two things that are easy to get wrong at every call site:
 * conditional requests (a 304 costs no rate limit at all) and rate-limit headers.
 */
export const getClientForUser = async (userId) => {
  const token = await tokenForUser(userId);
  if (!token) return null;

  const request = async (path, { etag, ...opts } = {}) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(etag ? { 'If-None-Match': etag } : {}),
    };

    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...opts,
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    const rate = {
      remaining: Number(res.headers.get('x-ratelimit-remaining') ?? NaN),
      reset: Number(res.headers.get('x-ratelimit-reset') ?? NaN),
    };

    if (res.status === 304) {
      return { notModified: true, data: null, etag, rate, link: null };
    }

    if (res.status === 403 || res.status === 429) {
      // Secondary/abuse limits are per-app, so the caller must back the whole scan
      // off rather than hammer the next repo.
      const retryAfter = Number(res.headers.get('retry-after') ?? 0);
      const err = new Error(`GitHub rate limited (${res.status})`);
      err.rateLimited = true;
      err.retryAfterMs = (retryAfter || 60) * 1000;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}: ${await res.text()}`);
      err.status = res.status;
      throw err;
    }

    return {
      notModified: false,
      data: await res.json(),
      etag: res.headers.get('etag'),
      rate,
      link: res.headers.get('link'),
    };
  };

  return { request };
};

/** Follow RFC5988 pagination. */
export const nextPageUrl = (linkHeader) => {
  if (!linkHeader) return null;
  const match = linkHeader.split(',').find((p) => p.includes('rel="next"'));
  return match ? match.slice(match.indexOf('<') + 1, match.indexOf('>')) : null;
};
