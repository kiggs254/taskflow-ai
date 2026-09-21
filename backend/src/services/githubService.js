import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { truncateAtWord } from '../utils/text.js';
import { syncTask } from './taskService.js';
import { callAI } from './ai/callAI.js';
import {
  getClientForIntegration,
  getIntegrations,
  fetchInstallation,
  nextPageUrl,
  isGithubConfigured,
} from './githubAuth.js';
import { DEFAULT_TIMEZONE, localDateString, startOfLocalDayMs } from '../utils/time.js';

const MAX_PAGES = 5; // 500 commits/repo/day/branch; beyond this something is wrong
const MAX_BRANCHES = 100; // cap the fan-out on a repo with a runaway number of branches

/**
 * The logins whose commits count as this user's own work, across every connected
 * account.
 *
 * This is deliberately a *set*, and deliberately separate from the account an
 * installation sits on. `github_login` used to be `repos[0].owner.login`, which is
 * the ORG once repos are transferred to one -- and an org cannot author a commit, so
 * `&author=<org>` matched nothing and commit tracking stopped silently. An org
 * installation contributes no author login at all; it borrows the set built from the
 * user's personal installations (or whatever they typed in Settings).
 *
 * Empty means "don't filter" -- ingest every commit. That's the honest degradation:
 * over-reporting is visible, under-reporting is not.
 */
export const authorLoginsFor = async (userId) => {
  const result = await query(
    `SELECT DISTINCT author_login FROM github_integrations
      WHERE user_id = $1 AND author_login IS NOT NULL AND author_login <> ''`,
    [userId]
  );
  return result.rows.map((r) => r.author_login);
};

/**
 * Pull the repo list one installation currently grants and cache it.
 *
 * This has to be callable at any time, not just at install. The repo set changes
 * whenever the user edits the installation on GitHub, and the first fetch can fail
 * (bad JWT, clock skew, a transient 5xx) -- if the only fetch were at install time,
 * the integration would be stuck showing "Connected" with zero repos forever, with
 * re-installing as the only recovery.
 *
 * Never throws: returns {ok, error} so callers can surface the reason instead of
 * turning it into an opaque failure.
 */
const refreshOne = async (userId, integration) => {
  const client = await getClientForIntegration(integration);
  if (!client) return { ok: false, error: 'This GitHub account is no longer authorised.' };

  try {
    const all = [];
    let url = '/installation/repositories?per_page=100';
    let pages = 0;

    while (url && pages < MAX_PAGES) {
      const res = await client.request(url);
      all.push(...(res.data?.repositories || []));
      url = nextPageUrl(res.link);
      pages++;
    }

    // Who this installation belongs to, from GitHub rather than inferred from a repo
    // owner. `account.type` is the whole point: only a 'User' account can be a commit
    // author, and reading it from repos[0].owner.login is what broke on transfer.
    let account = { accountLogin: null, accountType: null };
    if (integration.installation_id) {
      try {
        account = await fetchInstallation(integration.installation_id);
      } catch (error) {
        // Non-fatal: the repo list is the useful part. A missing account label is
        // cosmetic; a missing repo list is not.
        console.warn(`GitHub: could not read installation metadata: ${error.message}`);
      }
    }

    // Never overwrite a login the user typed by hand, and never set an org as one.
    const authorLogin =
      integration.author_login ||
      (account.accountType === 'User' ? account.accountLogin : null);

    await query(
      `UPDATE github_integrations
          SET account_login = COALESCE($2, account_login),
              account_type  = COALESCE($3, account_type),
              author_login  = $4,
              last_error    = NULL
        WHERE id = $1`,
      [integration.id, account.accountLogin, account.accountType, authorLogin]
    );

    await upsertRepos(userId, integration.installation_id, all);
    await markLostRepos(userId, integration.installation_id, all);

    console.log(
      `GitHub: cached ${all.length} repo(s) for user ${userId} ` +
        `(${account.accountLogin ?? 'installation ' + integration.installation_id})`
    );
    return { ok: true, count: all.length };
  } catch (error) {
    console.error(`GitHub: failed to list repositories for user ${userId}:`, error.message);
    await query('UPDATE github_integrations SET last_error = $2 WHERE id = $1', [
      integration.id,
      error.message,
    ]);
    return { ok: false, error: error.message };
  }
};

/**
 * Refresh every connected account, or one of them.
 *
 * Aggregates rather than short-circuits: one broken installation (revoked, suspended)
 * must not stop the others from refreshing, or connecting a second account would make
 * the first one's repos unreachable.
 */
export const refreshRepos = async (userId, { installationId = null } = {}) => {
  const integrations = (await getIntegrations(userId)).filter(
    (i) => installationId === null || Number(i.installation_id) === Number(installationId)
  );
  if (!integrations.length) return { ok: false, error: 'GitHub is not connected for this user.' };

  let count = 0;
  const errors = [];
  for (const integration of integrations) {
    const result = await refreshOne(userId, integration);
    if (result.ok) count += result.count;
    else errors.push(`${integration.account_login ?? integration.installation_id}: ${result.error}`);
  }

  return errors.length === integrations.length
    ? { ok: false, error: errors.join('; '), count }
    : { ok: true, count, error: errors.length ? errors.join('; ') : null };
};

/**
 * Record an installation.
 *
 * ON CONFLICT is on (user_id, installation_id), not (user_id): a user can connect
 * several GitHub accounts, and keying on the user alone meant installing the app on
 * an org *replaced* the personal account's row -- its repos were left pointing at an
 * installation the user could no longer authenticate against.
 */
export const handleInstallCallback = async (userId, installationId) => {
  const inserted = await query(
    `INSERT INTO github_integrations (user_id, installation_id, auth_kind, enabled)
     VALUES ($1, $2, 'github_app', true)
     ON CONFLICT (user_id, installation_id) WHERE installation_id IS NOT NULL
     DO UPDATE SET enabled = true, last_error = NULL
     RETURNING *`,
    [userId, installationId]
  );

  // Deliberately does not throw on a failed repo fetch. The installation itself is
  // real and recorded; the repo list is recoverable and is re-fetched by /status and
  // /repos. Throwing here used to abort the callback *after* the row was written,
  // which left exactly the state this fixes: "Connected", zero repos, no way back.
  const result = await refreshOne(userId, inserted.rows[0]);
  return { repos: result.count ?? 0, error: result.ok ? null : result.error };
};

const upsertRepos = async (userId, installationId, repos) => {
  for (const r of repos) {
    await query(
      `INSERT INTO github_repos (user_id, repo_id, owner, name, default_branch, installation_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, repo_id) DO UPDATE
         SET owner = EXCLUDED.owner,
             name = EXCLUDED.name,
             default_branch = EXCLUDED.default_branch,
             -- A transfer moves a repo between installations while keeping its
             -- numeric id, so the row follows it rather than 404ing against the old
             -- account's token forever.
             installation_id = EXCLUDED.installation_id,
             access_lost_at = NULL`,
      [userId, r.id, r.owner.login, r.name, r.default_branch, installationId]
    );
  }
};

/**
 * Tombstone repos this installation no longer grants.
 *
 * Not a DELETE. `repo_id` is the identity behind processed_commits and every
 * `gh-{uid}-{repoId}-...` task id, and `selected` is the user's own choice -- drop
 * the row and a repo that comes back (transferred to an org the app is also installed
 * on, say) re-ingests its whole history as brand new work.
 */
const markLostRepos = async (userId, installationId, repos) => {
  const ids = repos.map((r) => Number(r.id)).filter(Number.isFinite);
  await query(
    `UPDATE github_repos
        SET access_lost_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND installation_id = $2
        AND access_lost_at IS NULL
        AND NOT (repo_id = ANY($3::bigint[]))`,
    [userId, installationId, ids]
  );
};

export const listRepos = async (userId) => {
  const result = await query(
    `SELECT r.repo_id AS "repoId", r.owner, r.name, r.default_branch AS "defaultBranch",
            r.selected, r.last_polled_at AS "lastPolledAt",
            r.installation_id AS "installationId",
            r.access_lost_at AS "accessLostAt",
            i.account_login AS "accountLogin"
     FROM github_repos r
     LEFT JOIN github_integrations i
       ON i.user_id = r.user_id AND i.installation_id = r.installation_id
     WHERE r.user_id = $1
     ORDER BY r.selected DESC, r.owner, r.name`,
    [userId]
  );
  return result.rows;
};

/** Replace the tracked-repo selection. */
export const setSelectedRepos = async (userId, repoIds) => {
  const ids = (Array.isArray(repoIds) ? repoIds : []).map(Number).filter(Number.isFinite);
  await query('UPDATE github_repos SET selected = false WHERE user_id = $1', [userId]);
  if (ids.length) {
    await query(
      'UPDATE github_repos SET selected = true WHERE user_id = $1 AND repo_id = ANY($2::bigint[])',
      [userId, ids]
    );
  }
  return listRepos(userId);
};

export const getGithubStatus = async (userId) => {
  if (!isGithubConfigured()) {
    return { connected: false, configured: false };
  }

  const integrations = await getIntegrations(userId);
  if (!integrations.length) return { connected: false, configured: true, accounts: [], repos: [] };

  let repos = await listRepos(userId);
  let repoError = null;

  // Self-heal, on two triggers:
  //
  //  - an empty cache means the install-time fetch failed, or the user has since
  //    changed which repos the app can see;
  //  - an account with no repos at all means the same for that one account, which the
  //    user-wide emptiness check used to miss entirely once a second account existed.
  //
  // Re-fetch rather than telling them to reinstall, and report *why* if GitHub
  // refuses.
  const starved = integrations.filter(
    (i) => !repos.some((r) => Number(r.installationId) === Number(i.installation_id))
  );
  if (starved.length) {
    for (const integration of starved) {
      const refreshed = await refreshOne(userId, integration);
      if (!refreshed.ok) repoError = refreshed.error;
    }
    repos = await listRepos(userId);
  }

  const fresh = await getIntegrations(userId);
  const authorLogins = [...new Set(fresh.map((i) => i.author_login).filter(Boolean))];

  return {
    connected: true,
    configured: true,
    accounts: fresh.map((i) => ({
      installationId: i.installation_id === null ? null : Number(i.installation_id),
      accountLogin: i.account_login,
      accountType: i.account_type,
      authorLogin: i.author_login,
      lastScanAt: i.last_scan_at,
      scanFrequency: i.scan_frequency,
      enabled: i.enabled,
      lastError: i.last_error,
      repoCount: repos.filter((r) => Number(r.installationId) === Number(i.installation_id)).length,
      selectedCount: repos.filter(
        (r) => Number(r.installationId) === Number(i.installation_id) && r.selected
      ).length,
    })),
    // An empty author set means no commit is filtered out -- every contributor's work
    // would be logged as yours. Surfaced so it can be fixed rather than discovered in
    // a report.
    authorLogins,
    authorLoginMissing: authorLogins.length === 0,
    repos,
    repoError,
    selectedCount: repos.filter((r) => r.selected).length,
    // Kept for the previous single-account shape of this response.
    login: authorLogins[0] ?? fresh[0]?.account_login ?? null,
    lastScanAt: fresh.map((i) => i.last_scan_at).filter(Boolean).sort().pop() ?? null,
    scanFrequency: fresh[0]?.scan_frequency ?? 30,
    enabled: fresh.some((i) => i.enabled),
  };
};

/**
 * Per-account settings. `installationId` selects which account; omitting it applies
 * to all of them, which is what the frequency control does.
 */
export const updateGithubSettings = async (
  userId,
  { installationId = null, scanFrequency, enabled, authorLogin } = {}
) => {
  const sets = [];
  const params = [userId];
  if (Number.isFinite(scanFrequency)) {
    params.push(Math.min(1440, Math.max(5, Math.round(scanFrequency))));
    sets.push(`scan_frequency = $${params.length}`);
  }
  if (typeof enabled === 'boolean') {
    params.push(enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (typeof authorLogin === 'string') {
    // Trimmed to null rather than stored as '' -- authorLoginsFor filters on NULL,
    // and an empty string would sneak into the set and match no commits at all.
    const trimmed = authorLogin.trim();
    params.push(trimmed || null);
    sets.push(`author_login = $${params.length}`);
  }

  if (sets.length) {
    let where = 'user_id = $1';
    if (installationId !== null && installationId !== undefined) {
      params.push(installationId);
      where += ` AND installation_id = $${params.length}`;
    }
    await query(`UPDATE github_integrations SET ${sets.join(', ')} WHERE ${where}`, params);
  }
  return getGithubStatus(userId);
};

/**
 * Disconnect one account, or all of them.
 *
 * Only that account's repos go. Deleting every repo row when one of several accounts
 * is removed would wipe the tracked-repo selection for accounts the user kept -- and
 * because `repo_id` is the identity behind processed_commits, re-adding them would
 * have re-ingested nothing but still lost the selection.
 */
export const disconnectGithub = async (userId, { installationId = null } = {}) => {
  if (installationId === null || installationId === undefined) {
    await query('DELETE FROM github_repos WHERE user_id = $1', [userId]);
    await query('DELETE FROM github_integrations WHERE user_id = $1', [userId]);
    return { success: true, removed: 'all' };
  }

  await query('DELETE FROM github_repos WHERE user_id = $1 AND installation_id = $2', [
    userId,
    installationId,
  ]);
  await query('DELETE FROM github_integrations WHERE user_id = $1 AND installation_id = $2', [
    userId,
    installationId,
  ]);
  return { success: true, removed: Number(installationId) };
};

/**
 * Fetch this user's commits to one repo since `sinceIso`.
 *
 * Uses /repos/{owner}/{repo}/commits rather than the Events API (90-day window,
 * 300-event cap, eventually consistent, omits private repos for installation
 * tokens -- silently lossy, which is the worst failure mode for a report someone
 * reads) or the Search API (separate quota, indexing lag).
 */
/** Every branch name in the repo, capped. */
const listBranches = async (client, repo) => {
  const names = [];
  let url = `/repos/${repo.owner}/${repo.name}/branches?per_page=100`;
  let pages = 0;
  while (url && pages < 3) {
    const res = await client.request(url);
    for (const b of res.data || []) if (b?.name) names.push(b.name);
    url = nextPageUrl(res.link);
    pages++;
  }
  return names.slice(0, MAX_BRANCHES);
};

/**
 * Whether a commit was authored by one of the user's logins.
 *
 * `c.author` is the *linked GitHub account*, which is what the API's `author=` filter
 * resolves to as well -- so this is the same test, just done locally. It is null for a
 * commit whose email isn't attached to any account, and those are excluded either way.
 */
const authoredBy = (commit, logins) => {
  if (!logins.length) return true; // no known login -> no filter
  const login = commit?.author?.login;
  return login ? logins.some((l) => l.toLowerCase() === login.toLowerCase()) : false;
};

/**
 * Today's commits on ONE branch.
 *
 * `author=` takes a single value, so it's only usable as a payload optimisation when
 * exactly one login is known. With several connected accounts we fetch the branch
 * unfiltered and apply `authoredBy` locally -- `since` already bounds this to one day,
 * so the extra rows are few, and the alternative (one request per login per branch)
 * multiplies the fan-out for no gain.
 */
const fetchBranchCommits = async (client, repo, branch, { logins = [], sinceIso }) => {
  const commits = [];
  const serverFilter = logins.length === 1 ? logins[0] : null;
  let url =
    `/repos/${repo.owner}/${repo.name}/commits` +
    `?sha=${encodeURIComponent(branch)}` +
    `&since=${encodeURIComponent(sinceIso)}` +
    `&per_page=100` +
    (serverFilter ? `&author=${encodeURIComponent(serverFilter)}` : '');

  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const res = await client.request(url);
    commits.push(...(res.data || []));
    url = nextPageUrl(res.link);
    pages++;
  }

  if (pages >= MAX_PAGES && url) {
    console.warn(
      `GitHub: ${repo.owner}/${repo.name}@${branch} hit the ${MAX_PAGES}-page cap; ` +
        `some commits were not ingested for this day.`
    );
  }
  return commits;
};

/**
 * How many commits the branch had in the window, ignoring authorship.
 *
 * Only called when the author filter produced nothing, and only to answer "was the
 * repo quiet, or is the filter wrong?" -- the question a bare "0 new commits" leaves
 * you to guess at, and the one that hid an org name sitting in the author field. One
 * page is plenty: we need "some" vs "none", not a total.
 */
const countUnfilteredCommits = async (client, repo, branch, sinceIso) => {
  try {
    const res = await client.request(
      `/repos/${repo.owner}/${repo.name}/commits` +
        `?sha=${encodeURIComponent(branch)}` +
        `&since=${encodeURIComponent(sinceIso)}` +
        `&per_page=100`
    );
    return (res.data || []).length;
  } catch {
    return 0; // diagnostics must never fail a scan
  }
};

/**
 * All of today's commits across EVERY branch, deduped by SHA.
 *
 * The commits API has no "all branches" mode -- `sha` selects a single ref and defaults
 * to the default branch -- so work on a feature branch was invisible until it merged to
 * main. We enumerate branches and union their commits; the same SHA on several branches
 * (before a merge, or a shared base) collapses to one, and processed_commits dedups
 * again on insert. `since`+`author` keep each branch's payload tiny, so the fan-out is
 * cheap even on a repo with many branches.
 *
 * This drops the per-repo ETag short-circuit the single-branch path had. At the default
 * 30-min scan frequency that's a handful of small requests per repo, far inside the
 * GitHub App's 15k/hr budget; correctness across branches is worth more than a 304.
 *
 * Exported for testing against a fake client.
 */
export const fetchRepoCommits = async (client, repo, { logins = [], sinceIso, diagnose = false }) => {
  const branches = await listBranches(client, repo);
  // If a repo somehow reports no branches, fall back to its recorded default so a
  // single-branch repo still works.
  const scan = branches.length ? branches : [repo.default_branch || 'main'];

  const bySha = new Map();
  const branchOf = new Map();
  // Commits the repo had in the window at all, before the author filter. The whole
  // point of tracking it: "0 commits" and "0 commits *by you*" are different answers
  // to "why is my report empty", and only one of them is a bug.
  const seenShas = new Set();

  for (const branch of scan) {
    let commits;
    try {
      commits = await fetchBranchCommits(client, repo, branch, { logins, sinceIso });
    } catch (err) {
      // A rate-limit must stop the whole scan; a branch deleted/renamed mid-scan
      // (404/409) should just be skipped rather than abort the repo.
      if (err?.rateLimited) throw err;
      continue;
    }
    for (const c of commits) {
      if (c?.sha) seenShas.add(c.sha);
      // Skipped when the server already filtered (one login): GitHub matched it, so
      // re-testing could only ever discard a commit it deliberately included.
      if (logins.length > 1 && !authoredBy(c, logins)) continue;
      if (c?.sha && !bySha.has(c.sha)) {
        bySha.set(c.sha, c);
        branchOf.set(c.sha, branch);
      }
    }
  }

  const matched = [...bySha.values()];

  // With a single login GitHub did the filtering, so seenShas only holds what already
  // matched -- ask again without the filter, but only when the answer matters.
  let seen = seenShas.size;
  if (diagnose && matched.length === 0 && logins.length === 1) {
    for (const branch of scan) {
      seen += await countUnfilteredCommits(client, repo, branch, sinceIso);
      if (seen > 0) break; // "any" is the whole question
    }
  }

  return { commits: matched, branchOf, notModified: false, seen };
};

// Same commits + same label -> same title, so rebuilding a branch's task on every scan
// (the repo re-scans whenever ANY branch gets a commit) reuses one smart-tier call
// instead of re-billing. Content-addressed and bounded.
const dayTitleCache = new Map();
const DAY_TITLE_CACHE_MAX = 500;

/** One AI-written summary line for a branch's day of work. */
const summariseDay = async (userId, repoName, commits) => {
  const subjects = commits.map((c) => `- ${c.message.split('\n')[0]}`).join('\n');
  const fallback = `${repoName} — ${commits.length} commit${commits.length > 1 ? 's' : ''}`;

  const key = crypto.createHash('sha256').update(`${repoName}\n${subjects}`).digest('hex');
  if (dayTitleCache.has(key)) return dayTitleCache.get(key);

  const remember = (title) => {
    if (dayTitleCache.size >= DAY_TITLE_CACHE_MAX) {
      dayTitleCache.delete(dayTitleCache.keys().next().value);
    }
    dayTitleCache.set(key, title);
    return title;
  };

  try {
    const { content } = await callAI({
      taskKind: 'commit_rollup',
      tier: 'smart', // runs in cron; nobody is waiting on it
      userId,
      temperature: 0.2,
      maxTokens: 800,
      schema: {
        name: 'commit_summary',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary'],
          properties: {
            summary: {
              type: 'string',
              description: 'One line, max 70 chars, past tense, describing the day\'s work.',
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You summarise a developer\'s day of commits into one short past-tense line for a ' +
            'standup report. Be concrete and specific about what changed. No filler, no commit ' +
            'hashes, no "various changes". Return JSON.',
        },
        { role: 'user', content: `Repository: ${repoName}\n\nToday's commit subjects:\n${subjects}` },
      ],
    });

    const parsed = JSON.parse(content);
    const summary = parsed?.summary;
    if (!summary || typeof summary !== 'string') {
      // Succeeded but wrong shape. Without this the only symptom is a task titled
      // "repo — N commits" while telemetry cheerfully reports ok=true.
      console.error(
        'GitHub: model returned no `summary` field; falling back. ' +
          `Keys received: [${Object.keys(parsed ?? {}).join(', ') || 'none'}]. ` +
          `Raw (first 300): ${String(content).slice(0, 300)}`
      );
      return fallback; // don't cache a fallback -- retry it next scan
    }
    // truncateAtWord, not slice: a hard cut landed mid-word and read as corruption.
    return remember(`${repoName} — ${truncateAtWord(summary, 80)}`);
  } catch (error) {
    // A summary is a nicety; never lose the commit record over it.
    console.error('GitHub: commit summary failed, using fallback:', error.message);
    return fallback;
  }
};

/**
 * Scan selected repos and materialise each repo-day of commits as one completed task.
 *
 * Idempotency comes from two independent mechanisms:
 *   1. The task id is deterministic (`gh-{repoId}-{YYYY-MM-DD}`) and syncTask is an
 *      upsert, so re-running rewrites the same row instead of creating another.
 *   2. processed_commits records every SHA, so a deleted task is never rebuilt from
 *      commits that were already accounted for.
 */
export const scanCommits = async (
  userId,
  { timezone = DEFAULT_TIMEZONE, installationId = null, diagnose = false } = {}
) => {
  const integrations = (await getIntegrations(userId)).filter(
    (i) => installationId === null || Number(i.installation_id) === Number(installationId)
  );
  if (!integrations.length) return { success: false, reason: 'not_connected' };

  // One set for the whole sweep: the same human authors commits in their personal
  // repos and in their org's, so the filter is per-user, not per-installation.
  const logins = await authorLoginsFor(userId);

  // Flattened so each repo carries the client that can actually reach it. A single
  // per-user client authenticated every repo against one installation, which 404s on
  // every repo belonging to any other connected account.
  const repos = [];
  const scannedIds = [];
  for (const integration of integrations) {
    let client;
    try {
      client = await getClientForIntegration(integration);
    } catch (error) {
      console.error(`GitHub: auth failed for installation ${integration.installation_id}:`, error.message);
      await query('UPDATE github_integrations SET last_error = $2 WHERE id = $1', [integration.id, error.message]);
      continue;
    }
    if (!client) continue;
    scannedIds.push(integration.id);

    const rows = (
      await query(
        `SELECT repo_id, owner, name, default_branch, etag
         FROM github_repos
         WHERE user_id = $1 AND installation_id = $2
           AND selected = true AND access_lost_at IS NULL`,
        [userId, integration.installation_id]
      )
    ).rows;
    for (const r of rows) repos.push({ ...r, client });
  }

  if (!scannedIds.length) return { success: false, reason: 'not_connected' };
  if (!repos.length) {
    return { success: true, tasksCreated: 0, commitsIngested: 0, reason: 'no_repos', authorLogins: logins };
  }

  // Pinning `since` to local midnight keeps the request URL stable all day, which is
  // what makes the ETag actually match and the poll cost nothing.
  const dayStartMs = startOfLocalDayMs(timezone);
  const sinceIso = new Date(dayStartMs).toISOString();
  const day = localDateString(timezone, dayStartMs);

  let commitsIngested = 0;
  let tasksTouched = 0;
  // Diagnostics, so an empty scan can say WHY it was empty.
  let commitsMatched = 0;   // in the window and authored by one of `logins`
  let commitsInWindow = 0;  // in the window at all, whoever wrote them

  for (const repo of repos) {
    try {
      const { commits, branchOf, seen } = await fetchRepoCommits(repo.client, repo, {
        logins,
        sinceIso,
        // Only pay for the unfiltered probe on a hand-run scan. The cron sweep runs
        // every 30 minutes across every repo and nobody reads its reasoning.
        diagnose,
      });
      commitsMatched += commits.length;
      commitsInWindow += seen ?? commits.length;

      await query(
        'UPDATE github_repos SET last_polled_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND repo_id = $2',
        [userId, repo.repo_id]
      );

      if (!commits.length) continue;

      // Merge commits are plumbing, not work, and would double-count every PR.
      const real = commits.filter((c) => (c.parents?.length ?? 1) <= 1);

      for (const c of real) {
        const committedAt = Date.parse(c.commit?.author?.date ?? c.commit?.committer?.date);
        if (!Number.isFinite(committedAt)) continue;

        const inserted = await query(
          `INSERT INTO processed_commits (user_id, repo_id, sha, committed_at, message, html_url, branch)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id, repo_id, sha) DO NOTHING
           RETURNING id`,
          [
            userId,
            repo.repo_id,
            c.sha,
            committedAt,
            c.commit?.message ?? '',
            c.html_url ?? null,
            branchOf.get(c.sha) ?? repo.default_branch ?? null,
          ]
        );
        if (inserted.rows.length) commitsIngested++;
      }

      // Rebuild from the ledger rather than this response, so each task reflects every
      // commit recorded for the day, not just this batch.
      const dayCommits = (
        await query(
          `SELECT sha, message, html_url, committed_at, branch
           FROM processed_commits
           WHERE user_id = $1 AND repo_id = $2 AND committed_at >= $3 AND committed_at < $4
           ORDER BY committed_at ASC`,
          [userId, repo.repo_id, dayStartMs, dayStartMs + 86_400_000]
        )
      ).rows;

      if (!dayCommits.length) continue;

      const repoName = `${repo.owner}/${repo.name}`;
      const defaultBranch = repo.default_branch || 'main';

      // One task per branch, not per repo: work on a feature branch is its own task
      // rather than lumped in with main. Legacy rows with no branch fall back to the
      // default branch (that's how they were stored before branch scanning).
      const byBranch = new Map();
      for (const c of dayCommits) {
        const b = c.branch || defaultBranch;
        if (!byBranch.has(b)) byBranch.set(b, []);
        byBranch.get(b).push(c);
      }

      for (const [branch, branchCommits] of byBranch) {
        // Branch names contain '/', so slug them for the id. userId is in the id
        // deliberately: repo_id is GitHub's *global* id, so an un-namespaced id would
        // collide across users tracking the same repo; syncTask's user_id guard is the
        // second line of defence.
        const branchSlug = branch.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'branch';
        const taskId = `gh-${userId}-${repo.repo_id}-${branchSlug}-${day}`;
        // Show the branch in the label for anything but the default branch, so two
        // tasks on one repo read as distinct work.
        const label = branch === defaultBranch ? repo.name : `${repo.name} (${branch})`;
        const title = await summariseDay(userId, label, branchCommits);
        const lastCommitAt = Number(branchCommits[branchCommits.length - 1].committed_at);

        const task = {
          id: taskId,
          title,
          // Concise; the subtasks already list every commit. The branch is named here
          // so the source is unambiguous.
          description: `${branchCommits.length} commit${branchCommits.length > 1 ? 's' : ''} to ${repoName} on ${branch} (${day}).`,
          // Integration-sourced work is always 'job'.
          workspace: 'job',
          energy: 'medium',
          status: 'done',
          estimatedTime: null,
          tags: ['github', repo.name, branch],
          dependencies: [],
          subtasks: branchCommits.map((c, i) => ({
            id: `${taskId}-${i}`,
            title: c.message.split('\n')[0].slice(0, 120),
            completed: true,
            completedAt: Number(c.committed_at),
            // The commit link, carried on the subtask rather than dumped as raw text.
            url: c.html_url || null,
          })),
          // Commit time, not scan time: the work happened when it was committed.
          createdAt: Number(branchCommits[0].committed_at),
          completedAt: lastCommitAt,
        };

        await syncTask(userId, task);
        tasksTouched++;

        // Re-point by SHA (not a time range), so each commit lands on exactly its
        // branch's task and the grouping can't drift.
        await query(
          `UPDATE processed_commits SET task_id = $3
           WHERE user_id = $1 AND repo_id = $2 AND sha = ANY($4::text[])`,
          [userId, repo.repo_id, taskId, branchCommits.map((c) => c.sha)]
        );
      }
    } catch (error) {
      if (error.rateLimited) {
        // Per-app limit: abandon the whole sweep, don't move to the next repo.
        console.warn(`GitHub: rate limited for user ${userId}; ending scan early.`);
        break;
      }
      if (error.status === 404) {
        // GitHub answers 404 (not 403) for a repo an installation cannot see, so this
        // is what a transfer or a revoked grant looks like from inside a scan. Tombstone
        // it here rather than waiting for someone to press Refresh: otherwise the repo
        // just stops producing commits, which is indistinguishable from a quiet week.
        await query(
          `UPDATE github_repos SET access_lost_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND repo_id = $2 AND access_lost_at IS NULL`,
          [userId, repo.repo_id]
        );
        console.warn(
          `GitHub: lost access to ${repo.owner}/${repo.name}; it was transferred or its ` +
            `grant was revoked. Connect the account that owns it now to resume tracking.`
        );
        continue;
      }
      console.error(`GitHub: failed scanning ${repo.owner}/${repo.name}:`, error.message);
    }
  }

  // Drop any gh- task no longer backed by a commit -- notably the old per-repo-day task
  // whose commits were just re-pointed to per-branch tasks. task_id FK is ON DELETE SET
  // NULL, so this can't cascade into the ledger. Scoped to this user.
  await query(
    `DELETE FROM tasks
     WHERE user_id = $1 AND id LIKE 'gh-%'
       AND NOT EXISTS (SELECT 1 FROM processed_commits WHERE task_id = tasks.id)`,
    [userId]
  );

  // Only the accounts actually reached. Stamping every row would hide a broken
  // installation behind a fresh "last scan" time and mute the scanner's own gate.
  await query(
    'UPDATE github_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])',
    [scannedIds]
  );

  return {
    success: true,
    tasksCreated: tasksTouched,
    commitsIngested,
    // Everything needed to explain a zero without reading the server log.
    authorLogins: logins,
    reposScanned: repos.length,
    commitsMatched,
    commitsInWindow,
    day,
  };
};

/** Commit-derived completed tasks for a local day. Gates the daily report. */
export const getCommitTaskIdsForDay = async (userId, dayStartMs, dayEndMs) => {
  const result = await query(
    `SELECT DISTINCT task_id FROM processed_commits
     WHERE user_id = $1 AND committed_at >= $2 AND committed_at < $3 AND task_id IS NOT NULL`,
    [userId, dayStartMs, dayEndMs]
  );
  return result.rows.map((r) => r.task_id);
};
