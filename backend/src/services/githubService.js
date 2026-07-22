import { query } from '../config/database.js';
import { truncateAtWord } from '../utils/text.js';
import { syncTask } from './taskService.js';
import { callAI } from './ai/callAI.js';
import { getClientForUser, nextPageUrl, isGithubConfigured } from './githubAuth.js';
import { DEFAULT_TIMEZONE, localDateString, startOfLocalDayMs } from '../utils/time.js';

const MAX_PAGES = 5; // 500 commits/repo/day; beyond this something is wrong

/**
 * Complete the GitHub App installation callback.
 * `userId` comes from the *verified* signed state, never from the query string.
 */
/**
 * Pull the repo list GitHub currently grants this installation and cache it.
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
export const refreshRepos = async (userId) => {
  let client;
  try {
    client = await getClientForUser(userId);
  } catch (error) {
    console.error(`GitHub: auth failed for user ${userId}:`, error.message);
    return { ok: false, error: error.message };
  }
  if (!client) return { ok: false, error: 'GitHub is not connected for this user.' };

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

    // Needed to filter commits by author.
    const login = all[0]?.owner?.login ?? null;
    if (login) {
      await query('UPDATE github_integrations SET github_login = $2 WHERE user_id = $1', [userId, login]);
    }

    await upsertRepos(userId, all);
    console.log(`GitHub: cached ${all.length} repo(s) for user ${userId}`);
    return { ok: true, count: all.length };
  } catch (error) {
    console.error(`GitHub: failed to list repositories for user ${userId}:`, error.message);
    return { ok: false, error: error.message };
  }
};

export const handleInstallCallback = async (userId, installationId) => {
  await query(
    `INSERT INTO github_integrations (user_id, installation_id, auth_kind, enabled)
     VALUES ($1, $2, 'github_app', true)
     ON CONFLICT (user_id) DO UPDATE
       SET installation_id = EXCLUDED.installation_id,
           auth_kind = 'github_app',
           enabled = true`,
    [userId, installationId]
  );

  // Deliberately does not throw on a failed repo fetch. The installation itself is
  // real and recorded; the repo list is recoverable and is re-fetched by /status and
  // /repos. Throwing here used to abort the callback *after* the row was written,
  // which left exactly the state this fixes: "Connected", zero repos, no way back.
  const result = await refreshRepos(userId);
  return { repos: result.count ?? 0, error: result.ok ? null : result.error };
};

const upsertRepos = async (userId, repos) => {
  for (const r of repos) {
    await query(
      `INSERT INTO github_repos (user_id, repo_id, owner, name, default_branch)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, repo_id) DO UPDATE
         SET owner = EXCLUDED.owner,
             name = EXCLUDED.name,
             default_branch = EXCLUDED.default_branch`,
      [userId, r.id, r.owner.login, r.name, r.default_branch]
    );
  }
};

export const listRepos = async (userId) => {
  const result = await query(
    `SELECT repo_id AS "repoId", owner, name, default_branch AS "defaultBranch",
            selected, last_polled_at AS "lastPolledAt"
     FROM github_repos WHERE user_id = $1
     ORDER BY selected DESC, owner, name`,
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

  const result = await query(
    `SELECT github_login, last_scan_at, scan_frequency, enabled
     FROM github_integrations WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return { connected: false, configured: true };

  let repos = await listRepos(userId);
  let repoError = null;

  // Self-heal: an empty cache means the install-time fetch failed or the user has
  // since changed which repos the app can see. Re-fetch rather than telling them to
  // reinstall, and report *why* if GitHub refuses.
  if (repos.length === 0) {
    const refreshed = await refreshRepos(userId);
    if (refreshed.ok) repos = await listRepos(userId);
    else repoError = refreshed.error;
  }

  return {
    connected: true,
    configured: true,
    login: row.github_login,
    lastScanAt: row.last_scan_at,
    scanFrequency: row.scan_frequency,
    enabled: row.enabled,
    repos,
    repoError,
    selectedCount: repos.filter((r) => r.selected).length,
  };
};

export const updateGithubSettings = async (userId, { scanFrequency, enabled }) => {
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
  if (sets.length) {
    await query(`UPDATE github_integrations SET ${sets.join(', ')} WHERE user_id = $1`, params);
  }
  return getGithubStatus(userId);
};

export const disconnectGithub = async (userId) => {
  // Repos and the ledger go too -- but note the ledger's task_id is ON DELETE SET
  // NULL from the *tasks* side; deleting the integration is an explicit user action,
  // so clearing history here is intended.
  await query('DELETE FROM github_repos WHERE user_id = $1', [userId]);
  await query('DELETE FROM github_integrations WHERE user_id = $1', [userId]);
  return { success: true };
};

/**
 * Fetch this user's commits to one repo since `sinceIso`.
 *
 * Uses /repos/{owner}/{repo}/commits rather than the Events API (90-day window,
 * 300-event cap, eventually consistent, omits private repos for installation
 * tokens -- silently lossy, which is the worst failure mode for a report someone
 * reads) or the Search API (separate quota, indexing lag).
 */
const fetchRepoCommits = async (client, repo, { login, sinceIso }) => {
  const commits = [];
  let url =
    `/repos/${repo.owner}/${repo.name}/commits` +
    `?sha=${encodeURIComponent(repo.default_branch || 'main')}` +
    `&since=${encodeURIComponent(sinceIso)}` +
    `&per_page=100` +
    (login ? `&author=${encodeURIComponent(login)}` : '');

  let pages = 0;
  let etag = repo.etag;
  let firstEtag = null;

  while (url && pages < MAX_PAGES) {
    const res = await client.request(url, { etag: pages === 0 ? etag : undefined });

    // `since` is pinned to local midnight, so the URL is stable for 24h and repeat
    // polls within a day hit this branch. 304s don't count against the rate limit.
    if (res.notModified) return { commits: [], etag, notModified: true, rate: res.rate };

    if (pages === 0) firstEtag = res.etag;
    commits.push(...(res.data || []));
    url = nextPageUrl(res.link);
    pages++;
  }

  if (pages >= MAX_PAGES && url) {
    console.warn(
      `GitHub: ${repo.owner}/${repo.name} hit the ${MAX_PAGES}-page cap; ` +
        `some commits were not ingested for this day.`
    );
  }

  return { commits, etag: firstEtag, notModified: false };
};

/** One AI-written summary line for a repo's day of work. */
const summariseDay = async (userId, repoName, commits) => {
  const subjects = commits.map((c) => `- ${c.message.split('\n')[0]}`).join('\n');
  const fallback = `${repoName} — ${commits.length} commit${commits.length > 1 ? 's' : ''}`;

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
      return fallback;
    }
    // truncateAtWord, not slice: a hard cut landed mid-word and read as corruption.
    return `${repoName} — ${truncateAtWord(summary, 80)}`;
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
export const scanCommits = async (userId, { timezone = DEFAULT_TIMEZONE } = {}) => {
  const client = await getClientForUser(userId);
  if (!client) return { success: false, reason: 'not_connected' };

  const integration = await query(
    'SELECT github_login FROM github_integrations WHERE user_id = $1',
    [userId]
  );
  const login = integration.rows[0]?.github_login;

  const repos = (
    await query(
      `SELECT repo_id, owner, name, default_branch, etag
       FROM github_repos WHERE user_id = $1 AND selected = true`,
      [userId]
    )
  ).rows;

  if (!repos.length) return { success: true, tasksCreated: 0, commitsIngested: 0, reason: 'no_repos' };

  // Pinning `since` to local midnight keeps the request URL stable all day, which is
  // what makes the ETag actually match and the poll cost nothing.
  const dayStartMs = startOfLocalDayMs(timezone);
  const sinceIso = new Date(dayStartMs).toISOString();
  const day = localDateString(timezone, dayStartMs);

  let commitsIngested = 0;
  let tasksTouched = 0;

  for (const repo of repos) {
    try {
      const { commits, etag, notModified } = await fetchRepoCommits(client, repo, { login, sinceIso });

      await query(
        'UPDATE github_repos SET last_polled_at = CURRENT_TIMESTAMP, etag = COALESCE($3, etag) WHERE user_id = $1 AND repo_id = $2',
        [userId, repo.repo_id, etag]
      );

      if (notModified || !commits.length) continue;

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
            repo.default_branch ?? null,
          ]
        );
        if (inserted.rows.length) commitsIngested++;
      }

      // Rebuild today's task from the ledger rather than from this response, so the
      // task reflects every commit ever recorded for the day, not just this batch.
      const dayCommits = (
        await query(
          `SELECT sha, message, html_url, committed_at
           FROM processed_commits
           WHERE user_id = $1 AND repo_id = $2 AND committed_at >= $3 AND committed_at < $4
           ORDER BY committed_at ASC`,
          [userId, repo.repo_id, dayStartMs, dayStartMs + 86_400_000]
        )
      ).rows;

      if (!dayCommits.length) continue;

      const repoName = `${repo.owner}/${repo.name}`;
      // userId is part of the id deliberately: repo_id is GitHub's *global* id, so
      // `gh-{repo_id}-{day}` collides across TaskFlow users who track the same repo,
      // and syncTask's conflict target is the id alone. Namespacing keeps each user's
      // repo-day task distinct; syncTask's user_id guard is the second line of defence.
      const taskId = `gh-${userId}-${repo.repo_id}-${day}`;
      const title = await summariseDay(userId, repo.name, dayCommits);
      const lastCommitAt = Number(dayCommits[dayCommits.length - 1].committed_at);

      const task = {
        id: taskId,
        title,
        // One concise line, not a second copy of every commit. The subtasks below
        // already list every commit message; repeating them here -- each trailed by a
        // raw https://github.com/... URL that renders as a wall of text -- just showed
        // the same 14 messages twice. Commit links are kept on the subtasks instead.
        description: `${dayCommits.length} commit${dayCommits.length > 1 ? 's' : ''} to ${repoName} on ${day}.`,
        // Integration-sourced work is always 'job'.
        workspace: 'job',
        energy: 'medium',
        status: 'done',
        estimatedTime: null,
        tags: ['github', repo.name],
        dependencies: [],
        subtasks: dayCommits.map((c, i) => ({
          id: `${taskId}-${i}`,
          title: c.message.split('\n')[0].slice(0, 120),
          completed: true,
          completedAt: Number(c.committed_at),
          // The commit link, carried on the subtask rather than dumped as raw text in
          // the description. Extra JSONB fields are inert to the current UI but let it
          // link the commit later without another scan.
          url: c.html_url || null,
        })),
        // Commit time, not scan time: the work happened when it was committed.
        createdAt: Number(dayCommits[0].committed_at),
        completedAt: lastCommitAt,
      };

      await syncTask(userId, task);
      tasksTouched++;

      await query(
        `UPDATE processed_commits SET task_id = $3
         WHERE user_id = $1 AND repo_id = $2 AND committed_at >= $4 AND committed_at < $5`,
        [userId, repo.repo_id, taskId, dayStartMs, dayStartMs + 86_400_000]
      );
    } catch (error) {
      if (error.rateLimited) {
        // Per-app limit: abandon the whole sweep, don't move to the next repo.
        console.warn(`GitHub: rate limited for user ${userId}; ending scan early.`);
        break;
      }
      console.error(`GitHub: failed scanning ${repo.owner}/${repo.name}:`, error.message);
    }
  }

  await query(
    'UPDATE github_integrations SET last_scan_at = CURRENT_TIMESTAMP WHERE user_id = $1',
    [userId]
  );

  return { success: true, tasksCreated: tasksTouched, commitsIngested };
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
