#!/usr/bin/env node
/**
 * TaskFlow — reports a finished Claude Code session as completed work.
 *
 * Registered for SessionEnd (not Stop: Stop fires once per *turn*, i.e. after every
 * assistant reply). SessionEnd cannot block and its exit code is ignored, so this is
 * fire-and-forget by design and can never delay or break session exit.
 *
 * The privacy boundary lives here. The work-path allowlist is checked LOCALLY,
 * against a cached copy of the policy, so a personal session sends nothing at all —
 * not a filtered request, not an empty one. Nothing leaves the machine.
 *
 * Setup:
 *   export TASKFLOW_API_URL=https://your-backend/api
 *   export TASKFLOW_TOKEN=tf_...        # Settings -> Claude Code -> generate token
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const DIR = path.join(HOME, '.taskflow');
const SESSIONS = path.join(DIR, 'sessions');
const POLICY_CACHE = path.join(DIR, 'policy.json');
const POLICY_TTL_MS = 60 * 60 * 1000;

const API = (process.env.TASKFLOW_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.TASKFLOW_TOKEN;

const readStdin = () =>
  new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 2000);
  });

const api = async (route, options = {}) => {
  const res = await fetch(`${API}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${route} -> ${res.status}`);
  return res.json();
};

/**
 * The allowlist, cached. Fetched rarely; a stale cache is fine — worst case a new
 * work folder isn't logged until the cache expires. Failing closed (returning no
 * paths) is the safe direction: it under-reports rather than leaking.
 */
const getPolicy = async () => {
  try {
    const stat = fs.statSync(POLICY_CACHE);
    if (Date.now() - stat.mtimeMs < POLICY_TTL_MS) {
      return JSON.parse(fs.readFileSync(POLICY_CACHE, 'utf8'));
    }
  } catch {
    /* no cache yet */
  }

  const policy = await api('/agent/policy');
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(POLICY_CACHE, JSON.stringify(policy), { mode: 0o600 });
  return policy;
};

/** Longest matching prefix wins, so a sub-folder can override its parent. */
const matchWorkPath = (dir, workPaths = []) => {
  const target = path.resolve(dir);
  let best = null;
  for (const rule of workPaths) {
    const root = path.resolve(rule.path).replace(/\/+$/, '');
    // Boundary-aware: '/a/bcd' must not match a rule for '/a/b'.
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    if (!best || root.length > best.path.length) best = { ...rule, path: root };
  }
  return best;
};

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const main = async () => {
  if (!API || !TOKEN) return; // not configured; stay silent

  const input = JSON.parse((await readStdin()) || '{}');
  const sessionId = input.session_id;
  if (!sessionId) return;

  const safeId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
  const logFile = path.join(SESSIONS, `${safeId}.jsonl`);

  // `cwd` is wherever the session happened to be when the hook fired, which is not
  // necessarily the project root. CLAUDE_PROJECT_DIR is the documented way to get it.
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;

  try {
    const policy = await getPolicy();

    // THE PRIVACY GATE. Everything below this line only runs for work folders.
    const rule = policy.enabled === false ? null : matchWorkPath(projectDir, policy.workPaths || []);
    if (!rule) return;

    let prompts = [];
    let changedPaths = [];
    const times = [];
    try {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const e = JSON.parse(line);
        if (Number.isFinite(e.at)) times.push(e.at);
        if (e.t === 'prompt') prompts.push(e.v);
        else if (e.t === 'file') changedPaths.push(e.v);
      }
    } catch {
      /* no log: a session that changed nothing */
    }

    changedPaths = [...new Set(changedPaths)];
    if (!prompts.length && !changedPaths.length) return; // nothing happened

    // Real timestamps from the recorded entries, not "now" — the task's completedAt
    // should reflect when the work happened, matching how commit tasks use commit
    // time rather than scan time.
    const startedAt = times.length ? Math.min(...times) : Date.now();
    const endedAt = times.length ? Math.max(...times) : Date.now();

    // Commits made in this repo today. The server uses these to decide whether the
    // GitHub scanner already covers this work; it does NOT trust them as the record.
    const gitRemote = git(projectDir, ['remote', 'get-url', 'origin']);
    const commitShas = gitRemote
      ? git(projectDir, ['log', '--since=midnight', '--format=%H']).split('\n').filter(Boolean)
      : [];

    await api('/agent/log-work', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        cwd: input.cwd,
        projectDir,
        gitRemote: gitRemote || null,
        commitShas,
        changedPaths,
        prompts,
        startedAt,
        endedAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
  } finally {
    // Always clean up, including for personal sessions that returned early — their
    // prompts should not sit on disk in our directory.
    try {
      fs.unlinkSync(logFile);
    } catch {
      /* already gone */
    }
  }
};

main().catch(() => {}).finally(() => process.exit(0));
