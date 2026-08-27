import { query } from '../config/database.js';
import { getClientForUser, nextPageUrl } from './githubAuth.js';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../utils/time.js';

/**
 * Monthly KPI figures, assembled from three sources and honest about which is which.
 *
 *   commits (GitHub)        -> feature / bug / rollback counts
 *   ebiz-manager /api/kpi   -> uptime, downtime, incidents, MTTR, vulnerabilities
 *   TaskFlow's own tables   -> client-reported issues, bug backlog
 *
 * Every figure carries a `source`, and anything nothing can prove comes back as
 * `value: null` with `source: 'manual'` rather than a plausible number. A KPI sheet
 * that a manager validates against system records is the last place to invent one.
 *
 * Commits are read from GitHub for the whole month rather than from processed_commits:
 * that ledger only holds what the scanner has ingested since it was switched on, so it
 * cannot answer for a month that predates it. GitHub is the system of record.
 */

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * Parse a conventional-commit subject.
 * Returns { type, scope, breaking, subject } or null when it isn't conventional.
 */
export const classifyCommit = (message) => {
  const subject = String(message || '').split('\n')[0].trim();
  const m = subject.match(CONVENTIONAL);
  if (!m) return null;
  return {
    type: m[1].toLowerCase(),
    scope: (m[2] || '').toLowerCase() || null,
    breaking: Boolean(m[3]),
    subject: m[4],
  };
};

/** Month bounds as ISO instants. `month` is 'YYYY-MM'. */
export const monthRange = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error('month must be YYYY-MM');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = Date.UTC(year, mon - 1, 1);
  const end = Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1) - 1;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { startMs: start, endMs: end, fromDay: day(start), toDay: day(end), sinceIso: new Date(start).toISOString(), untilIso: new Date(end).toISOString() };
};

const MAX_PAGES = 10;
const MAX_BRANCHES = 100;

/** Every commit by this author in one repo in the window, across all branches. */
const fetchRepoMonthCommits = async (client, repo, { login, sinceIso, untilIso }) => {
  let branches = [];
  try {
    let url = `/repos/${repo.owner}/${repo.name}/branches?per_page=100`;
    let pages = 0;
    while (url && pages < 3) {
      const res = await client.request(url);
      for (const b of res.data || []) if (b?.name) branches.push(b.name);
      url = nextPageUrl(res.link);
      pages++;
    }
  } catch {
    /* fall back to the default branch below */
  }
  const scan = (branches.length ? branches : [repo.default_branch || 'main']).slice(0, MAX_BRANCHES);

  const bySha = new Map();
  for (const branch of scan) {
    let url =
      `/repos/${repo.owner}/${repo.name}/commits` +
      `?sha=${encodeURIComponent(branch)}` +
      `&since=${encodeURIComponent(sinceIso)}` +
      `&until=${encodeURIComponent(untilIso)}` +
      `&per_page=100` +
      (login ? `&author=${encodeURIComponent(login)}` : '');
    let pages = 0;
    try {
      while (url && pages < MAX_PAGES) {
        const res = await client.request(url);
        for (const c of res.data || []) if (c?.sha && !bySha.has(c.sha)) bySha.set(c.sha, c);
        url = nextPageUrl(res.link);
        pages++;
      }
    } catch (err) {
      if (err?.rateLimited) throw err;
      // A branch deleted mid-scan shouldn't lose the rest of the repo.
    }
  }
  return [...bySha.values()];
};

/** Commit-derived figures for the month, across the user's selected repos. */
export const getCommitMetrics = async (userId, { sinceIso, untilIso }) => {
  const repos = (
    await query(
      `SELECT repo_id, owner, name, default_branch
         FROM github_repos WHERE user_id = $1 AND selected = true`,
      [userId]
    )
  ).rows;

  const integration = await query(
    'SELECT github_login FROM github_integrations WHERE user_id = $1',
    [userId]
  );
  const login = integration.rows[0]?.github_login;

  if (!repos.length) return { repos: 0, commits: 0, byType: {}, perRepo: [], incomplete: true };

  const client = await getClientForUser(userId);
  const byType = {};
  const perRepo = [];
  let totalCommits = 0;
  let unconventional = 0;

  for (const repo of repos) {
    const commits = await fetchRepoMonthCommits(client, repo, { login, sinceIso, untilIso });
    // Merge commits are plumbing and would double-count every PR.
    const real = commits.filter((c) => (c.parents?.length ?? 1) <= 1);
    let repoFeat = 0;
    let repoFix = 0;
    for (const c of real) {
      const parsed = classifyCommit(c.commit?.message);
      if (!parsed) {
        unconventional++;
        continue;
      }
      byType[parsed.type] = (byType[parsed.type] || 0) + 1;
      if (parsed.type === 'feat') repoFeat++;
      if (parsed.type === 'fix') repoFix++;
      if (parsed.scope === 'security' || parsed.type === 'security') {
        byType.security = (byType.security || 0) + 1;
      }
    }
    totalCommits += real.length;
    perRepo.push({ repo: `${repo.owner}/${repo.name}`, commits: real.length, feat: repoFeat, fix: repoFix });
  }

  return { repos: repos.length, commits: totalCommits, unconventional, byType, perRepo, incomplete: false };
};

/** Ask ebiz-manager for the fleet facts. Returns null when not configured. */
export const getFleetMetrics = async (userId, { fromDay, toDay }) => {
  const row = (
    await query('SELECT * FROM kpi_settings WHERE user_id = $1', [userId])
  ).rows[0];
  if (!row?.fleet_base_url || !row?.fleet_api_key) return null;

  const ids = Array.isArray(row.work_instance_ids) ? row.work_instance_ids : [];
  const url =
    `${String(row.fleet_base_url).replace(/\/$/, '')}/api/kpi` +
    `?from=${encodeURIComponent(fromDay)}&to=${encodeURIComponent(toDay)}` +
    (ids.length ? `&instances=${encodeURIComponent(ids.join(','))}` : '');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${row.fleet_api_key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ebiz-manager /api/kpi -> ${res.status}`);
  return res.json();
};

/** Work TaskFlow itself can answer: issues that arrived from clients, bug backlog. */
export const getTaskMetrics = async (userId, { startMs, endMs }) => {
  const clientIssues = (
    await query(
      `SELECT COUNT(*)::int AS n FROM draft_tasks
        WHERE user_id = $1 AND source IN ('gmail','slack')
          AND EXTRACT(EPOCH FROM created_at) * 1000 BETWEEN $2 AND $3`,
      [userId, startMs, endMs]
    )
  ).rows[0]?.n ?? 0;

  const bugBacklog = (
    await query(
      `SELECT COUNT(*)::int AS n FROM tasks
        WHERE user_id = $1 AND status <> 'done'
          AND (tags @> '["bug"]'::jsonb OR lower(title) LIKE 'fix%')
          AND created_at <= $2`,
      [userId, endMs]
    )
  ).rows[0]?.n ?? 0;

  return { clientReportedIssues: clientIssues, bugBacklog };
};

const auto = (value, note) => ({ value, source: 'auto', note: note ?? null });
const manual = (note) => ({ value: null, source: 'manual', note });
const fleet = (value, note) => ({ value, source: 'fleet', note: note ?? null });

/**
 * The full monthly KPI set, in the five weighted categories of the review template.
 * Shape is deliberately flat and typed by `source` so a renderer can show provenance
 * and a human can see at a glance what still needs filling in.
 */
export const getMonthlyKpi = async (userId, { month, timezone = DEFAULT_TIMEZONE } = {}) => {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const range = monthRange(month);

  const [commits, tasks] = await Promise.all([
    getCommitMetrics(userId, range),
    getTaskMetrics(userId, range),
  ]);

  let fleetData = null;
  let fleetError = null;
  try {
    fleetData = await getFleetMetrics(userId, range);
  } catch (e) {
    fleetError = e.message;
  }

  const t = commits.byType || {};
  const featCount = t.feat || 0;
  const fixCount = t.fix || 0;
  const revertCount = t.revert || 0;
  // Rollback rate is expressed against shipped work (features + fixes), not all
  // commits: chores and docs are not releases and would dilute it.
  const shipped = featCount + fixCount;
  const rollbackPct = shipped > 0 ? Number(((revertCount / shipped) * 100).toFixed(2)) : null;

  const sys = fleetData?.system;
  const sec = fleetData?.security;

  return {
    month,
    timezone: tz,
    period: { from: range.fromDay, to: range.toDay },
    evidence: {
      repos: commits.repos,
      commits: commits.commits,
      unconventionalCommits: commits.unconventional,
      perRepo: commits.perRepo,
      fleetConnected: Boolean(fleetData),
      fleetError,
    },
    categories: [
      {
        name: 'Feature Development',
        weight: 30,
        metrics: [
          { metric: 'Number of Sub Features Released', target: 'Tracked', ...auto(featCount, `feat: commits across ${commits.repos} repo(s)`) },
          { metric: 'Number of Clients Using the Sub Feature', target: 'Tracked', ...manual('No product-analytics source connected') },
          { metric: '% of Sub Features Released On Schedule', target: '≥ 85%', ...manual('Needs planned release dates per feature') },
          { metric: 'Number of Major Features Released', target: 'Confirm with manager', ...manual('Named list (TikTok, Payment Gateway, Tokenization, Canvas, AI Reporting, Food Delivery) — mark which shipped') },
          { metric: 'Feature Adoption Rate', target: '≥ 50%', ...manual('Needs product analytics (30-day active usage)') },
        ],
      },
      {
        name: 'Bugs',
        weight: 20,
        metrics: [
          { metric: 'Number of Bugs Reported', target: 'Tracked', ...manual('Needs a bug tracker; TaskFlow sees fixes, not reports') },
          { metric: 'Number of Bugs Fixed', target: 'Tracked', ...auto(fixCount, 'fix: commits') },
          { metric: 'Max Bug Fixing Time', target: '< 3 days', ...manual('Needs report→fix timestamps from a tracker') },
          { metric: 'Critical/High-Severity Bugs Reported', target: 'Tracked', ...manual('Needs severity labelling') },
          { metric: 'Critical Bug Fixing Time', target: '< 24 hours', ...manual('Needs severity labelling') },
          { metric: 'Bug Re-open Rate', target: '< 5%', ...manual('Needs reopen tracking') },
          { metric: 'Bug Backlog (open at end of period)', target: '< 5', ...auto(tasks.bugBacklog, 'Open TaskFlow tasks tagged bug / titled fix — approximate') },
          { metric: 'Average Bug Triage Time', target: '< 24 hours', ...manual('Needs triage timestamps') },
        ],
      },
      {
        name: 'System',
        weight: 30,
        metrics: [
          { metric: 'System Downtime Hours', target: '< 1 hour', ...fleet(sys?.downtimeHours ?? null, sys ? 'From uptime_daily probes' : 'ebiz-manager not connected') },
          { metric: 'System Uptime %', target: '≥ 99.5%', ...fleet(sys?.uptimePct ?? null, sys?.worstInstance ? `Worst instance ${sys.worstInstance.uptimePct}%` : null) },
          { metric: 'Number of Critical Incidents (P0/P1)', target: 'Tracked', ...fleet(sys?.criticalIncidents ?? null, 'Alerts opened in period') },
          { metric: 'Mean Time to Resolve (MTTR)', target: '< 3 hours', ...fleet(sys?.mttrHours ?? null, 'Closed alerts only') },
          { metric: 'Production Incidents from Missed QA Coverage', target: '< 5', ...manual('Needs incident→root-cause classification') },
        ],
      },
      {
        name: 'Security & Compliance',
        weight: 10,
        metrics: [
          { metric: 'Number of Security Incidents', target: '0', ...manual('A detected CVE is not a breach — confirm manually') },
          { metric: 'PCI-DSS / Compliance Checklist Completion', target: '100% before go-live', ...manual('Needs the checklist as a source') },
          { metric: 'Number of Vulnerabilities Identified', target: 'Tracked', ...fleet(sec?.vulnerabilitiesIdentified ?? null, sec ? `${sec.criticalVulnerabilitiesIdentified ?? 0} critical` : 'ebiz-manager not connected') },
          { metric: 'Number of Vulnerabilities Resolved', target: 'Confirm with manager', ...fleet(sec?.vulnerabilitiesResolved ?? null, sec ? `${sec.vulnerabilitiesOpenAtEnd ?? 0} still open` : null) },
        ],
      },
      {
        name: 'Delivery & Team',
        weight: 10,
        metrics: [
          { metric: 'Number of Releases Deployed', target: 'Tracked', ...manual('Needs deploy events (Coolify/GitHub releases)') },
          { metric: '% of Releases Requiring Rollback/Hotfix', target: '< 3%', ...auto(rollbackPct, `${revertCount} revert: of ${shipped} shipped commits`) },
          { metric: 'Team Sprint Completion Rate', target: '≥ 85%', ...manual('Needs sprint data') },
          { metric: 'Number of Client-Reported Issues', target: 'Tracked', ...auto(tasks.clientReportedIssues, 'Draft tasks sourced from Gmail/Slack') },
        ],
      },
    ],
  };
};
