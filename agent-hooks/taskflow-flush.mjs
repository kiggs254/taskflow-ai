#!/usr/bin/env node
/**
 * TaskFlow — post a Claude Code session's work WITHOUT ending the session.
 *
 * SessionEnd is an event, not a timer: it fires on /clear, logout or Ctrl-D, and never
 * at all if you leave the session open. So a long day's work sits on disk until you
 * actually close the session. This posts a snapshot now.
 *
 * Usage:
 *   taskflow-flush.mjs              # the most recent session inside a work folder
 *   taskflow-flush.mjs <sessionId>  # an explicit session (must be in a work folder)
 *   taskflow-flush.mjs --list       # work sessions on disk; -> marks the pick
 *
 * SCOPE: only sessions inside the work folders configured in Settings -> Claude Code
 * are ever considered. Sessions anywhere else are not listed, not posted, and not
 * touched -- the same allowlist the SessionEnd hook enforces, applied here so the
 * command can be run from anywhere without picking up an unrelated project.
 *
 * Runs the SessionEnd hook with --keep, so the log survives and keeps accumulating.
 * agent_sessions upserts on (user, session, day) and REPLACES the row's prompts and
 * summary, so a flush that consumed the log would make the real session-end post
 * overwrite this work with only whatever came after it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HOME = os.homedir();
const SESSIONS = path.join(HOME, '.taskflow', 'sessions');
const POLICY_CACHE = path.join(HOME, '.taskflow', 'policy.json');
const CONFIG = path.join(HOME, '.taskflow', 'config.json');
const PROJECTS = path.join(HOME, '.claude', 'projects');
const HOOK = path.join(HOME, '.claude', 'hooks', 'taskflow-session-end.mjs');

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/**
 * Canonical absolute path.
 *
 * realpath, not just resolve: on macOS /tmp and /var are symlinks into /private, so a
 * recorded path under /var and a cwd of /private/var are the same directory that
 * path.resolve reports as unrelated. Falls back to resolve for a path that is gone.
 */
const canonical = (p) => {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
};

/**
 * The work-folder allowlist, from the cache the SessionEnd hook maintains.
 *
 * Fetched if absent so a first run isn't a dead end. Never guessed at: with no policy
 * there is no way to tell work from personal, and the safe answer is to stop.
 */
const getPolicy = async () => {
  try {
    return JSON.parse(fs.readFileSync(POLICY_CACHE, 'utf8'));
  } catch {
    /* fetch below */
  }
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    /* env may still supply it */
  }
  const api = (process.env.TASKFLOW_API_URL || cfg.apiUrl || '').replace(/\/$/, '');
  const token = process.env.TASKFLOW_TOKEN || cfg.token;
  if (!api || !token) {
    die(`No work-folder policy at ${POLICY_CACHE}, and no credentials in ${CONFIG} to fetch one.`);
  }
  try {
    const res = await fetch(`${api}/agent/policy`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`policy -> ${res.status}`);
    const policy = await res.json();
    fs.writeFileSync(POLICY_CACHE, JSON.stringify(policy), { mode: 0o600 });
    return policy;
  } catch (e) {
    die(`Could not read the work-folder policy: ${e.message}`);
  }
};

/**
 * Claude Code names each project directory after its path with every non-alphanumeric
 * character replaced by '-'. Deriving the slug from the allowlist (rather than parsing
 * it back into a path) sidesteps the ambiguity in the other direction: "Random AI
 * tasks" and "Random-AI-tasks" produce the same slug and cannot be told apart from it.
 */
const slugFor = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');

/** Longest matching prefix wins, so a sub-folder can override its parent. */
const matchWorkPath = (dir, workPaths) => {
  const target = canonical(dir).toLowerCase();
  let best = null;
  for (const rule of workPaths) {
    const root = canonical(rule.path).replace(/\/+$/, '');
    const lower = root.toLowerCase();
    if (target !== lower && !target.startsWith(`${lower}${path.sep}`)) continue;
    if (!best || root.length > best.path.length) best = { ...rule, path: root };
  }
  return best;
};

/** Every session log, with what it recorded. */
const readLogs = () => {
  let names;
  try {
    names = fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return names
    .map((f) => {
      const file = path.join(SESSIONS, f);
      const files = new Set();
      let prompts = 0;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.t === 'file') files.add(e.v);
          else if (e.t === 'prompt') prompts++;
        } catch {
          /* a partially written line; the hook tolerates these too */
        }
      }
      return {
        sessionId: path.basename(f, '.jsonl'),
        mtime: fs.statSync(file).mtimeMs,
        files: [...files],
        prompts,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
};

/**
 * Which work folder a session belongs to, or null if none.
 *
 * The session's own working directory comes first, via Claude Code's project folder.
 * Edited files are only a fallback, and a poor primary: a session working in a work
 * folder often edits nothing inside it -- scratch files land in the session's temp
 * directory, and that is not on the allowlist, so going by files alone silently
 * classified real work as personal and posted nothing.
 */
const workFolderOf = (log, workPaths) => {
  const bySlug = new Map(workPaths.map((r) => [slugFor(canonical(r.path)), r]));
  for (const [slug, rule] of bySlug) {
    if (fs.existsSync(path.join(PROJECTS, slug, `${log.sessionId}.jsonl`))) {
      return { ...rule, path: canonical(rule.path), via: 'session directory' };
    }
  }
  for (const f of log.files) {
    const hit = matchWorkPath(path.dirname(f), workPaths);
    if (hit) return { ...hit, via: 'edited files' };
  }
  return null;
};

const main = async () => {
  const arg = process.argv[2];
  const policy = await getPolicy();
  const workPaths = policy?.enabled === false ? [] : policy?.workPaths ?? [];
  if (!workPaths.length) {
    die('No work folders configured. Add one in TaskFlow -> Settings -> Claude Code.');
  }

  const all = readLogs();
  const candidates = [];
  let skipped = 0;
  for (const log of all) {
    const folder = workFolderOf(log, workPaths);
    if (folder) candidates.push({ ...log, folder });
    else skipped++;
  }

  // A session already in the work folder you are standing in wins over a newer one
  // elsewhere; otherwise the most recent work session.
  const here = matchWorkPath(process.cwd(), workPaths);
  const auto =
    (here && candidates.find((c) => c.folder.path === here.path)) ?? candidates[0] ?? null;

  if (arg === '--list') {
    console.log(`Work folders: ${workPaths.map((r) => r.path).join(', ')}`);
    if (!candidates.length) console.log('No sessions recorded inside them yet.');
    for (const c of candidates) {
      const mark = auto && c.sessionId === auto.sessionId ? '->' : '  ';
      console.log(
        `${mark} ${c.sessionId}  ${new Date(c.mtime).toLocaleString()}  ` +
          `${c.prompts}p ${c.files.length}f  ${c.folder.path}  (${c.folder.via})`
      );
    }
    if (skipped) console.log(`\n${skipped} session(s) outside the work folders — ignored.`);
    return;
  }

  let chosen = auto;
  if (arg) {
    chosen = candidates.find((c) => c.sessionId === arg) ?? null;
    if (!chosen) {
      const exists = all.some((l) => l.sessionId === arg);
      die(
        exists
          ? `Session ${arg} is not inside a work folder, so it is not logged. Nothing posted.`
          : `No log for session ${arg}. Try --list.`
      );
    }
  }
  if (!chosen) die(`No sessions recorded inside ${workPaths.map((r) => r.path).join(', ')}.`);

  console.log(
    `Flushing ${chosen.sessionId} (${chosen.prompts} prompt(s), ${chosen.files.length} file(s)) ` +
      `as ${chosen.folder.path}...`
  );

  const child = spawn(process.execPath, [HOOK, '--keep'], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: chosen.folder.path },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.end(JSON.stringify({ session_id: chosen.sessionId, cwd: chosen.folder.path }));

  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) die(`The session-end hook exited ${code}.`);
  // The hook is fire-and-forget by design and prints nothing on success, so say
  // something rather than leaving a silent exit looking like a no-op.
  console.log('Posted. It appears in TaskFlow as a completed task for today.');
};

main().catch((e) => die(e.message));
