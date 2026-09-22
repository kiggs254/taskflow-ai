#!/usr/bin/env node
/**
 * TaskFlow — post the current Claude Code session's work WITHOUT ending the session.
 *
 * SessionEnd is an event, not a timer: it fires on /clear, logout or Ctrl-D, and never
 * at all if you just leave the session open. So a long day's work sits on disk until
 * you actually close the session. This posts a snapshot now.
 *
 * Usage, from the project directory:
 *   taskflow-flush.mjs              # the session that has been editing files here
 *   taskflow-flush.mjs <sessionId>  # an explicit session
 *   taskflow-flush.mjs --list       # what is on disk, and which would be picked
 *
 * Runs the SessionEnd hook with --keep, so the log survives and keeps accumulating.
 * agent_sessions upserts on (user, session, day) and REPLACES the row's prompts and
 * summary, so a flush that consumed the log would make the real session-end post
 * overwrite this work with only whatever came after it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const SESSIONS = path.join(os.homedir(), '.taskflow', 'sessions');
const HOOK = path.join(os.homedir(), '.claude', 'hooks', 'taskflow-session-end.mjs');

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/**
 * Canonical absolute path.
 *
 * realpath, not just resolve: on macOS /tmp and /var are symlinks into /private, so a
 * recorded path under /var and a cwd of /private/var are the same directory that
 * path.resolve reports as unrelated -- and the session picker below silently matched
 * nothing. Falls back to resolve for a path that no longer exists.
 */
const canonical = (p) => {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
};

/** Project root, so the work-path allowlist is matched against the repo, not a subdir. */
const projectRoot = () => {
  try {
    return canonical(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
  } catch {
    return canonical(process.cwd());
  }
};

const logs = () => {
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
        file,
        mtime: fs.statSync(file).mtimeMs,
        files: [...files],
        prompts,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
};

/**
 * Which session is "this one".
 *
 * Several sessions run at once here, so newest-wins alone picks the wrong project
 * whenever another window is busier. Prefer the newest log that has actually edited a
 * file under this repo -- that is the session working on what you are looking at.
 */
const pick = (all, root) => {
  const under = (p) => {
    const abs = canonical(p);
    return abs === root || abs.startsWith(`${root}${path.sep}`);
  };
  return all.find((l) => l.files.some(under)) ?? null;
};

const main = async () => {
  const arg = process.argv[2];
  const root = projectRoot();
  const all = logs();

  if (arg === '--list') {
    if (!all.length) return console.log('No session logs in', SESSIONS);
    const chosen = pick(all, root);
    for (const l of all) {
      const mark = chosen && l.sessionId === chosen.sessionId ? '->' : '  ';
      console.log(
        `${mark} ${l.sessionId}  ${new Date(l.mtime).toLocaleTimeString()}  ` +
          `${l.prompts} prompt(s), ${l.files.length} file(s)`
      );
    }
    return;
  }

  if (!all.length) die(`No session logs in ${SESSIONS} — nothing recorded yet.`);

  const chosen = arg ? all.find((l) => l.sessionId === arg) : pick(all, root);
  if (arg && !chosen) die(`No log for session ${arg}. Try --list.`);
  if (!chosen) {
    die(
      `No session has edited a file under ${root}.\n` +
        `Run this from the project you are working in, or name the session explicitly ` +
        `(taskflow-flush.mjs --list).`
    );
  }

  console.log(
    `Flushing ${chosen.sessionId} (${chosen.prompts} prompt(s), ${chosen.files.length} file(s)) ` +
      `from ${root}...`
  );

  const child = spawn(process.execPath, [HOOK, '--keep'], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.end(JSON.stringify({ session_id: chosen.sessionId, cwd: root }));

  await new Promise((resolve) => child.on('close', resolve));
  // The hook is fire-and-forget by design and prints nothing on success, so say
  // something rather than leaving a silent exit looking like a no-op.
  console.log('Posted. It appears in TaskFlow as a completed task for today.');
};

main().catch((e) => die(e.message));
