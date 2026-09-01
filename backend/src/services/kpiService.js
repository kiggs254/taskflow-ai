import { query } from '../config/database.js';
import { getClientForUser, nextPageUrl } from './githubAuth.js';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../utils/time.js';

/**
 * Monthly KPI figures, assembled from three sources with nothing left for a human.
 *
 *   commits (GitHub)        -> features, fixes, severity, recurrence, rollbacks
 *   ebiz-manager /api/kpi   -> uptime, incidents, MTTR, vulnerabilities, deploys
 *   TaskFlow's own tables   -> client intake, backlog, delivery rate
 *
 * The review template assumes one team on one product; this role is many client
 * systems, mostly ecommerce. So where a metric has no literal equivalent it is measured
 * by the nearest observable one -- "clients using the feature" becomes client systems
 * that received feature work, "adoption" becomes systems live and serving -- and every
 * metric carries the definition used. That keeps the report automatic without inventing
 * anything: a manager validating against system records sees exactly what was counted.
 *
 * A metric with no data reports null rather than 0. "Not measured" and "none happened"
 * are different claims and the report must not pass the first off as the second.
 *
 * Commits are read from GitHub for the whole month rather than from processed_commits:
 * that ledger only holds what the scanner ingested since it was switched on, so it
 * cannot answer for a month that predates it.
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
const fetchRepoMonthCommits = async (client, repo, { login, sinceIso, untilIso, defaultBranch }) => {
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
  const primary = defaultBranch || repo.default_branch || 'main';
  // Scan the default branch FIRST so a commit present on both is attributed to it --
  // that is what "shipped to production" means here.
  const rest = branches.filter((b) => b !== primary);
  const scan = (branches.length ? [primary, ...rest] : [primary]).slice(0, MAX_BRANCHES);

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
          for (const c of res.data || []) {
          if (!c?.sha || bySha.has(c.sha)) continue;
          c.__onDefault = branch === primary;
          bySha.set(c.sha, c);
        }
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

/**
 * Scopes that are the critical path for an ecommerce build. A break in checkout or
 * payments is a different class of incident from a copy tweak, and this is the only
 * severity signal the commits carry, so it stands in for "critical/high severity".
 */
const CRITICAL_SCOPES = /(checkout|payment|pay|order|cart|stock|inventory|auth|login|security|fraud|tingg|mosmos|flexpay|paystack)/;

/** Commit-derived figures for the month, across the user's selected repos. */
export const getCommitMetrics = async (userId, { sinceIso, untilIso, startMs, endMs }) => {
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

  const empty = {
    repos: 0, commits: 0, unconventional: 0, byType: {}, perRepo: [],
    reposWithFeatures: 0, featOnDefault: 0, featTotal: 0, breaking: 0,
    criticalFixes: 0, recurringFixes: 0, distinctFixScopes: 0, fixTimestamps: [],
  };
  if (!repos.length) return empty;

  const client = await getClientForUser(userId);
  const byType = {};
  const perRepo = [];
  let totalCommits = 0;
  let unconventional = 0;
  let featOnDefault = 0;
  let featTotal = 0;
  let breaking = 0;
  let criticalFixes = 0;
  const reposWithFeatures = new Set();
  // scope -> sorted fix timestamps, for detecting a fix that had to be redone.
  const fixesByScope = new Map();
  const fixTimestamps = [];

  for (const repo of repos) {
    const defaultBranch = repo.default_branch || 'main';
    const commits = await fetchRepoMonthCommits(client, repo, { login, sinceIso, untilIso, defaultBranch });
    const real = commits.filter((c) => (c.parents?.length ?? 1) <= 1);
    let repoFeat = 0;
    let repoFix = 0;

    for (const c of real) {
      const parsed = classifyCommit(c.commit?.message);
      if (!parsed) { unconventional++; continue; }
      byType[parsed.type] = (byType[parsed.type] || 0) + 1;
      if (parsed.breaking) breaking++;

      if (parsed.type === 'feat') {
        repoFeat++;
        featTotal++;
        reposWithFeatures.add(`${repo.owner}/${repo.name}`);
        // Shipped to the production branch, rather than still sitting on a feature
        // branch at month end -- the closest honest reading of "released on schedule".
        if (c.__onDefault) featOnDefault++;
      }

      if (parsed.type === 'fix') {
        repoFix++;
        const at = Date.parse(c.commit?.author?.date ?? c.commit?.committer?.date);
        if (Number.isFinite(at)) fixTimestamps.push(at);
        const scopeKey = `${repo.name}:${parsed.scope || 'general'}`;
        if (!fixesByScope.has(scopeKey)) fixesByScope.set(scopeKey, []);
        if (Number.isFinite(at)) fixesByScope.get(scopeKey).push(at);
        if (CRITICAL_SCOPES.test(`${parsed.scope || ''} ${parsed.subject}`.toLowerCase())) criticalFixes++;
      }

      if (parsed.scope === 'security') byType.security = (byType.security || 0) + 1;
    }

    totalCommits += real.length;
    perRepo.push({ repo: `${repo.owner}/${repo.name}`, commits: real.length, feat: repoFeat, fix: repoFix });
  }

  // A second fix to the same area within 72h is a fix that did not hold. The window was
  // 14 days, which counts ordinary iteration on an active area as a reopened bug and
  // produced a rate many times the target -- wrong, and badly unflattering.
  const RECUR_MS = 72 * 3600 * 1000;
  let recurringFixes = 0;
  for (const times of fixesByScope.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] <= RECUR_MS) recurringFixes++;
  }

  return {
    repos: repos.length,
    commits: totalCommits,
    unconventional,
    byType,
    perRepo,
    reposWithFeatures: reposWithFeatures.size,
    featOnDefault,
    featTotal,
    breaking,
    criticalFixes,
    recurringFixes,
    distinctFixScopes: fixesByScope.size,
    fixTimestamps: fixTimestamps.sort((a, b) => a - b),
  };
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

/** Work TaskFlow itself can answer: intake volume, backlog, and delivery rate. */
export const getTaskMetrics = async (userId, { startMs, endMs }) => {
  const one = async (sql, params) => (await query(sql, params)).rows[0] ?? {};

  // Issues that arrived from a client channel, and when -- the intake queue.
  const arrivals = (
    await query(
      `SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS at
         FROM draft_tasks
        WHERE user_id = $1 AND source IN ('gmail','slack')
          AND EXTRACT(EPOCH FROM created_at) * 1000 BETWEEN $2 AND $3
        ORDER BY created_at ASC`,
      [userId, startMs, endMs]
    )
  ).rows.map((r) => Number(r.at));

  const backlog = await one(
    `SELECT COUNT(*)::int AS n FROM draft_tasks
      WHERE user_id = $1 AND status = 'pending'
        AND EXTRACT(EPOCH FROM created_at) * 1000 <= $2`,
    [userId, endMs]
  );

  // Delivery rate: of the work that existed for this month, how much got finished.
  const delivery = await one(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done' AND completed_at BETWEEN $2 AND $3)::int AS completed,
       COUNT(*) FILTER (WHERE created_at BETWEEN $2 AND $3)::int AS created
     FROM tasks WHERE user_id = $1`,
    [userId, startMs, endMs]
  );

  return {
    clientReportedIssues: arrivals.length,
    arrivals,
    pendingBacklog: backlog.n ?? 0,
    tasksCompleted: delivery.completed ?? 0,
    tasksCreated: delivery.created ?? 0,
  };
};

export const pct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : null);
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(1)));

/**
 * Median hours from a client report arriving to the next fix shipped.
 *
 * Stands in for triage time. Nothing links a specific report to a specific commit, so
 * this measures responsiveness rather than per-ticket handling, and the note on the
 * metric says so. Median, not mean, so one report left over a holiday doesn't dominate.
 */
export const responseHours = (arrivals, fixTimestamps) => {
  if (!arrivals.length || !fixTimestamps.length) return null;
  const gaps = [];
  for (const a of arrivals) {
    const next = fixTimestamps.find((t) => t >= a);
    if (next != null) gaps.push((next - a) / 3600000);
  }
  if (!gaps.length) return null;
  gaps.sort((x, y) => x - y);
  return round1(gaps[Math.floor(gaps.length / 2)]);
};


/**
 * A target the report can actually score against. `label` is what the review template
 * prints; op/value is what makes it comparable. A "Tracked" metric has no target and is
 * reported without being scored, rather than counted as a pass or a failure.
 */
const gte = (v, label) => ({ label: label ?? `≥ ${v}`, op: 'gte', value: v });
const lte = (v, label) => ({ label: label ?? `< ${v}`, op: 'lte', value: v });
const eq0 = (label) => ({ label: label ?? '0', op: 'eq', value: 0 });
const tracked = { label: 'Tracked', op: null };
/**
 * A metric the review template asks for that this role cannot produce: it presupposes a
 * team process (sprint commitments, a triaged bug queue, a tracker with reopen state)
 * that a solo developer on many client systems does not run. Kept visible so the
 * template is still answered, but excluded from scoring -- substituting a lookalike
 * proxy and scoring against it measured the proxy, not the work.
 */
const notApplicable = (reason) => ({ target: { label: 'n/a — solo developer', op: null }, na: true, value: null, source: 'n/a', note: reason });

/**
 * Score one metric.
 *
 * A metric with no data is 'no-data', never a miss: an absent measurement must not be
 * scored as a failure, or the total quietly punishes gaps in instrumentation rather
 * than gaps in the work.
 */
const scoreMetric = (value, target, na) => {
  if (na) return 'n/a';
  if (!target?.op) return 'no-target';
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'no-data';
  const n = Number(value);
  if (target.op === 'gte') return n >= target.value ? 'met' : 'missed';
  if (target.op === 'lte') return n <= target.value ? 'met' : 'missed';
  return n === target.value ? 'met' : 'missed';
};

/**
 * Category scores plus the weighted overall.
 *
 * The overall is renormalised across categories that actually have a score, so an
 * unmeasurable category doesn't silently drag the total toward zero. `coverage` says
 * how much of the weighting the score is based on, so a partial figure can't be read as
 * a complete one.
 */
export const scoreReport = (categories) => {
  let weighted = 0;
  let weightScored = 0;

  for (const c of categories) {
    let met = 0;
    let missed = 0;
    for (const m of c.metrics) {
      m.status = scoreMetric(m.value, m.target, m.na);
      if (m.status === 'met') met++;
      else if (m.status === 'missed') missed++;
      // Flatten the target back to its printable label for renderers.
      m.targetLabel = m.target?.label ?? 'Tracked';
    }
    const scoreable = met + missed;
    c.metricsMet = met;
    c.metricsScored = scoreable;
    c.score = scoreable ? Number(((met / scoreable) * 100).toFixed(1)) : null;
    if (c.score !== null) {
      weighted += (c.score * c.weight) / 100;
      weightScored += c.weight;
    }
  }

  return {
    // Out of the weight actually scored, not out of 100, so it is not overstated.
    overall: weightScored ? Number(((weighted / weightScored) * 100).toFixed(1)) : null,
    coverage: weightScored,
  };
};

/** A metric that was measured, with the definition used to measure it. */
const measured = (value, how) => ({ value, source: 'auto', note: how });
const fromFleet = (value, how) => ({ value, source: 'fleet', note: how });

/**
 * The full monthly KPI set.
 *
 * Every metric is derived; none is left for a human. Where the review template assumes
 * one team on one product and the work is actually many client systems, the metric is
 * measured by the nearest observable equivalent and the note states exactly what was
 * counted -- so a manager validating against system records can see the definition
 * rather than guess at it.
 */
const buildMonthlyKpi = async (userId, { month, timezone = DEFAULT_TIMEZONE } = {}) => {
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
  const sys = fleetData?.system;
  const sec = fleetData?.security;
  const del = fleetData?.delivery;
  const flt = fleetData?.fleet;

  // Releases: real deploy runs when the fleet is connected, otherwise commits that
  // reached a production branch.
  const releases = del?.deployRuns ?? null;
  // Reverts only. A deploy that FAILED never reached production, so it is a broken
  // build, not a release that had to be rolled back -- counting it doubled the rate.
  const rollbacks = revertCount;
  const rollbackPct = releases ? pct(rollbacks, releases) : pct(revertCount, featCount + fixCount);

  const categories = [
    {
      name: 'Feature Development',
      weight: 30,
      metrics: [
        { metric: 'Number of Sub Features Released', target: tracked,
          ...measured(featCount, `feat: commits across ${commits.repos} repo(s)`) },
        { metric: 'Client Systems Receiving Features', target: tracked,
          ...measured(commits.reposWithFeatures, 'Distinct client systems that received feature work') },
        { metric: '% of Sub Features Released On Schedule',
          ...notApplicable('No release schedule or sprint commitment is recorded anywhere. Branch-merge timing was standing in for it, which measures merge habits, not lateness') },
        { metric: 'Major Features / New Systems Launched', target: tracked,
          ...measured(
            flt?.monitored ? (flt.launchedInPeriod ?? 0) + commits.breaking : (commits.breaking || null),
            flt?.monitored
              ? 'Systems first seen live this month, plus breaking-change releases'
              : 'Breaking-change releases only — launch dates need fleet monitoring history') },
        { metric: 'Feature Adoption Rate', target: gte(50),
          ...fromFleet(
            flt?.liveInstances == null ? null : pct(flt.liveInstances, flt.totalInstances ?? 0),
            flt?.liveInstances == null
              ? 'No probe data for the selected systems this month'
              : 'Delivered systems live and serving traffic') },
      ],
    },
    {
      name: 'Bugs',
      weight: 20,
      metrics: [
        { metric: 'Number of Bugs Reported',
          ...notApplicable(`No bug tracker. ${tasks.clientReportedIssues} inbound client messages were received, but those are requests and conversation, not filed defects`) },
        { metric: 'Number of Bugs Fixed', target: tracked,
          ...measured(fixCount, 'fix: commits') },
        { metric: 'Max Bug Fixing Time', target: lte(3, '< 3 days'),
          ...fromFleet(sys?.maxIncidentHours != null ? round1(sys.maxIncidentHours / 24) : null, 'Longest single incident, in days') },
        { metric: 'Critical/High-Severity Bugs Reported', target: tracked,
          ...measured(commits.criticalFixes, 'Fixes on critical paths: checkout, payments, orders, stock, auth') },
        { metric: 'Critical Bug Fixing Time', target: lte(24, '< 24 hours'),
          ...fromFleet(sys?.mttrHours ?? null, 'Mean time to resolve an incident') },
        { metric: 'Bug Re-open Rate',
          ...notApplicable('Nothing records a bug being reopened. Repeat commits to one area were standing in for it, which is ordinary iteration while building') },
        { metric: 'Bug Backlog (open at end of period)',
          ...notApplicable(`No triaged bug queue. ${tasks.pendingBacklog} unreviewed AI task suggestions sat in the inbox, which is not the same thing`) },
        { metric: 'Average Bug Triage Time',
          ...notApplicable('No triage step exists to time. Report-to-next-fix was standing in for it, which is responsiveness, not triage') },
      ],
    },
    {
      name: 'System',
      weight: 30,
      metrics: [
        { metric: 'System Downtime Hours', target: lte(1, '< 1 hour'),
          ...fromFleet(sys?.downtimeHours ?? null,
            sys?.daysMonitored != null && sys.daysMonitored < (sys.daysInPeriod ?? 0)
              ? `Across work systems · only ${sys.daysMonitored} of ${sys.daysInPeriod} days were monitored`
              : 'Across work systems only') },
        { metric: 'System Uptime %', target: gte(99.5),
          ...fromFleet(sys?.uptimePct ?? null,
            [sys?.worstInstance ? `Worst system ${sys.worstInstance.uptimePct}%` : 'Health probes',
             sys?.daysMonitored != null && sys.daysMonitored < (sys.daysInPeriod ?? 0)
               ? `${sys.daysMonitored}/${sys.daysInPeriod} days monitored` : null].filter(Boolean).join(' · ')) },
        { metric: 'Number of Alerts Opened', target: tracked,
          ...fromFleet(sys?.criticalIncidents ?? null, 'All severities — not only P0/P1, which are not separately labelled') },
        { metric: 'Mean Time to Resolve (MTTR)', target: lte(3, '< 3 hours'),
          ...fromFleet(sys?.mttrHours ?? null, 'Closed incidents only') },
        { metric: 'Incidents Unresolved at Month End', target: lte(5, '< 5'),
          ...fromFleet(
            sys?.criticalIncidents != null ? Math.max(0, (sys.criticalIncidents ?? 0) - (sys.incidentsClosed ?? 0)) : null,
            'Root cause is not recorded, so this is not attributed to QA coverage') },
      ],
    },
    {
      name: 'Security & Compliance',
      weight: 10,
      metrics: [
        { metric: 'Number of Security Incidents', target: eq0(),
          ...fromFleet(sec?.criticalVulnerabilitiesIdentified ?? null, 'Critical findings from scanning — no breach is recorded anywhere') },
        { metric: 'PCI-DSS / Compliance Checklist', target: gte(100, '100% before go-live'),
          ...fromFleet(pct((flt?.totalInstances ?? 0) - (sec?.instancesWithExposureFindings ?? 0), flt?.totalInstances ?? 0), 'Work systems with no open exposure/TLS finding') },
        { metric: 'Number of Vulnerabilities Identified', target: tracked,
          ...fromFleet(sec?.scansRun ? (sec.vulnerabilitiesIdentified ?? 0) : null,
            sec?.scansRun ? `${sec.scansRun} scan(s) ran this month` : 'No vulnerability scan ran in this period') },
        { metric: 'Number of Vulnerabilities Resolved', target: tracked,
          ...fromFleet(sec?.scansRun ? (sec.vulnerabilitiesResolved ?? 0) : null,
            sec ? `${sec.vulnerabilitiesOpenAtEnd ?? 0} still open` : null) },
      ],
    },
    {
      name: 'Delivery & Team',
      weight: 10,
      metrics: [
        { metric: 'Number of Releases Deployed', target: tracked,
          ...(releases != null
            ? fromFleet(releases, `Deploy runs across ${del?.instancesDeployed ?? 0} system(s)`)
            : measured(commits.featOnDefault, 'Commits reaching a production branch (fleet not connected)')) },
        { metric: '% of Releases Requiring Rollback/Hotfix', target: lte(3, '< 3%'),
          ...measured(rollbackPct, `${revertCount} revert commit(s)${del?.failedDeployRuns ? ` · ${del.failedDeployRuns} deploy(s) failed before shipping, not counted as rollbacks` : ''}`) },
        { metric: 'Team Sprint Completion Rate',
          ...notApplicable('No sprints are run. Completed-vs-raised was standing in for it, and "raised" is inflated by auto-generated task suggestions') },
        { metric: 'Number of Client-Reported Issues', target: tracked,
          ...measured(tasks.clientReportedIssues, 'All inbound client messages (email/Slack) — volume, not filed issues') },
      ],
    },
  ];

  const { overall, coverage } = scoreReport(categories);

  return {
    month,
    timezone: tz,
    period: { from: range.fromDay, to: range.toDay },
    score: { overall, coverage },
    evidence: {
      repos: commits.repos,
      commits: commits.commits,
      unconventionalCommits: commits.unconventional,
      perRepo: commits.perRepo,
      fleetConnected: Boolean(fleetData),
      fleetError,
    },
    categories,
  };
};

/** The stored snapshot for a month, or null. */
export const getStoredKpi = async (userId, month) => {
  const r = await query(
    'SELECT report, generated_at FROM kpi_reports WHERE user_id = $1 AND month = $2',
    [userId, month]
  );
  if (!r.rows[0]) return null;
  return { ...r.rows[0].report, generatedAt: r.rows[0].generated_at };
};

/**
 * The month's report: the stored one if it exists, otherwise built and stored.
 *
 * `refresh` forces a rebuild. Generating walks every selected repo's branches on
 * GitHub, so this must not happen just because a page was opened -- and a report that
 * has already been sent to a manager should keep reporting the same figures rather than
 * quietly drifting as git history moves beneath it.
 */
export const getMonthlyKpi = async (userId, { month, timezone, refresh = false } = {}) => {
  if (!refresh) {
    const stored = await getStoredKpi(userId, month);
    if (stored) return stored;
  }

  const report = await buildMonthlyKpi(userId, { month, timezone });

  await query(
    `INSERT INTO kpi_reports (user_id, month, report, generated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, month) DO UPDATE
       SET report = EXCLUDED.report, generated_at = EXCLUDED.generated_at`,
    [userId, month, JSON.stringify(report)]
  );

  return { ...report, generatedAt: new Date().toISOString() };
};
