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
// A policy with no work folders means "not set up yet" — re-check often, or adding a
// folder in Settings appears to do nothing for an hour.
const UNCONFIGURED_TTL_MS = 2 * 60 * 1000;
// Logs we couldn't decide on are kept for a retry, but not forever.
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Config resolution: env first (so a shell can still override), then a config file.
//
// The env vars live in a shell profile like ~/.zshrc, which ONLY interactive shells
// source. A SessionEnd hook is spawned non-interactively, so it never saw them -- it
// bailed at the check below, posted nothing, and (correctly) kept the log, which is
// why logs piled up with no policy.json. The config file removes that dependency
// entirely: the hook reads its own credentials regardless of how the shell was
// started. Write ~/.taskflow/config.json as {"apiUrl":"...","token":"tf_..."}, mode
// 0600.
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
};
const cfg = readConfig();
const API = (process.env.TASKFLOW_API_URL || cfg.apiUrl || '').replace(/\/$/, '');
const TOKEN = process.env.TASKFLOW_TOKEN || cfg.token;

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
 * The allowlist, cached.
 *
 * Returns null when the policy can't be established — callers must treat that as
 * "don't know", not "not work".
 *
 * An empty/disabled policy gets a much shorter TTL than a populated one. "No work
 * folders" means the user hasn't finished setting up, which is exactly when they're
 * about to change it — caching that for an hour meant adding a folder appeared to do
 * nothing, and every session in the meantime was silently judged non-work.
 */
const getPolicy = async () => {
  const ttlFor = (p) =>
    p?.enabled && (p.workPaths?.length ?? 0) > 0 ? POLICY_TTL_MS : UNCONFIGURED_TTL_MS;

  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(POLICY_CACHE, 'utf8'));
    const age = Date.now() - fs.statSync(POLICY_CACHE).mtimeMs;
    if (age < ttlFor(cached)) return cached;
  } catch {
    /* no cache yet */
  }

  try {
    const policy = await api('/agent/policy');
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(POLICY_CACHE, JSON.stringify(policy), { mode: 0o600 });
    return policy;
  } catch {
    // Backend unreachable. Fall back to a stale cache if we have one, otherwise
    // admit we don't know rather than guessing "not work" and destroying the log.
    return cached;
  }
};

/**
 * Longest matching prefix wins, so a sub-folder can override its parent.
 *
 * Must stay in step with matchWorkPath in agentService.js — this is the gate that
 * decides whether anything leaves the machine, and the server re-checks it. If they
 * disagree, work silently vanishes (hook stricter) or a request gets made that the
 * server then rejects (hook looser).
 *
 * Case-insensitive: on macOS "/Desktop/Random AI tasks" and "/Desktop/random ai
 * tasks" are the same folder, so an exact compare turned a capitalisation slip in
 * Settings into permanent silent non-logging.
 */
const matchWorkPath = (dir, workPaths = []) => {
  const target = path.resolve(dir).toLowerCase();
  let best = null;
  for (const rule of workPaths) {
    const root = path.resolve(rule.path).replace(/\/+$/, '');
    const rootLower = root.toLowerCase();
    // Boundary-aware: '/a/bcd' must not match a rule for '/a/b'.
    if (target !== rootLower && !target.startsWith(`${rootLower}${path.sep}`)) continue;
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

  let decided = false; // did we reach a confident conclusion about this session?
  try {
    const policy = await getPolicy();

    // Couldn't establish the policy (backend down, no cache). Keep the log and try
    // again next time -- deleting it here would silently destroy the session on a
    // transient error, which is exactly how a real session was lost to a stale cache.
    if (!policy) return;

    decided = true;

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
    // Only discard the log once we actually decided. A confident "not work" should
    // delete it (a personal session's prompts shouldn't linger here); an *undecided*
    // session must keep it, or a transient backend blip silently destroys real work.
    if (decided) {
      try {
        fs.unlinkSync(logFile);
      } catch {
        /* already gone */
      }
    }

    // Undecided logs would otherwise accumulate forever if the backend stays down.
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(SESSIONS)) {
        const p = path.join(SESSIONS, f);
        if (now - fs.statSync(p).mtimeMs > LOG_MAX_AGE_MS) fs.unlinkSync(p);
      }
    } catch {
      /* best effort */
    }
  }
};

main().catch(() => {}).finally(() => process.exit(0));
