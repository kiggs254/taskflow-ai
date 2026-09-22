#!/usr/bin/env node
/**
 * TaskFlow — records what a Claude Code session did, as it happens.
 *
 * Registered for two events:
 *   UserPromptSubmit          -> records the request (the intent)
 *   PostToolUse (Edit|Write)  -> records the file touched
 *
 * Why not just read the transcript at the end? The Claude Code docs are explicit:
 * "The entry format is internal to Claude Code and changes between versions, so
 * scripts that parse these files directly can break on any release." And there is no
 * built-in "files edited this session". Recording as we go is the documented path,
 * and unlike `git diff` it works for work that isn't in a repo at all — which is the
 * entire point of this feature.
 *
 * Appends to ~/.taskflow/sessions/<session_id>.jsonl. taskflow-session-end.mjs reads
 * it, decides whether it's work, and deletes it.
 *
 * This runs on every prompt and every edit, so it must be fast and must never fail
 * in a way the user notices.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.taskflow', 'sessions');

/**
 * Strip anything that looks like a credential out of a shell command.
 *
 * This is the only thing standing between "record what was built" and "post an API key
 * to a web service". It runs BEFORE the command is written to disk, so a secret is
 * never persisted either.
 *
 * Deliberately over-eager: a redacted command that loses a harmless flag costs a
 * slightly vaguer summary, while a missed key is a leaked credential. Order matters --
 * assignments and flags are blanked first, so their values can't then be matched (and
 * kept) by a narrower rule.
 *
 * It cannot be complete. A secret in a shape nothing here anticipates will pass
 * through, which is why the work-folder allowlist still gates everything: commands
 * from personal folders are never recorded at all.
 */
const redact = (command) => {
  let out = command;

  const RULES = [
    // KEY=value / --password=value / -e SECRET=value, for anything secret-shaped.
    // The leading class includes quotes and backticks: a secret assignment is very
    // often inside a quoted remote command, e.g. ssh host 'SECRET_KEY=... ./run.sh',
    // and anchoring on whitespace alone let exactly that through.
    [/((?:^|[\s;&|(`'"])(?:[A-Za-z_][\w.-]*)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|SESSION|COOKIE|SALT|CERT|PRIVATE)[\w.-]*\s*=\s*)(["']?)[^\s"';|&]+\2/gi, '$1[redacted]'],
    // --password value / --token=value / --dbpass value / --api-key=value.
    // [\w-]* on BOTH sides of the keyword: tools prefix and suffix it freely
    // (--dbpass, --admin-password, --keyfile), and matching the bare word only meant
    // `wp db query --dbpass hunter2` kept its password in full.
    [/((?:--?)[\w-]*(?:pass(?:word|wd)?|token|secret|auth|bearer|api[-_]?key|key)[\w-]*[=\s]+)(["']?)[^\s"';|&]+\2/gi, '$1[redacted]'],
    // mysql-style attached short flag: -phunter2
    [/(\s-p)(?=\S)[^\s"';|&]+/g, '$1[redacted]'],
    // Authorization: Bearer xxx  /  -H 'Authorization: ...'
    [/((?:authorization|proxy-authorization)\s*:\s*)(?:bearer|basic|token)?\s*[^\s"';|&]+/gi, '$1[redacted]'],
    // Credentials inside a URL: scheme://user:pass@host
    [/(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1$2:[redacted]@'],
    // Well-known key prefixes, wherever they appear.
    [/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g, '[redacted]'],
    [/\b(gh[pousr]|github_pat|glpat|xox[baprs]|cfat|tf|npm|pypi|AIza|ya29|SG|AKIA|ASIA)[-_][A-Za-z0-9_.-]{12,}/g, '[redacted]'],
    [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
    // A JWT.
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]'],
    // PEM material, however it got onto one line.
    [/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key]'],
    // A bare high-entropy blob: 32+ chars of base64/hex with no separators. Catches
    // the shapes the named rules above don't know about.
    [/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[redacted]'],
  ];

  for (const [re, to] of RULES) out = out.replace(re, to);

  // A command that reads or writes an env file is worth knowing about, but never its
  // contents -- `cat .env` is fine, `echo "X=y" >> .env` must not keep the value.
  if (/\.env\b/.test(out) && /(^|\s)(echo|printf|cat\s*<<|tee)\b/.test(out)) {
    return '[redacted: wrote to an env file]';
  }

  return out;
};

const main = async () => {
  const raw = await new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    // A hook with no stdin must not hang a session.
    setTimeout(() => resolve(buf), 2000);
  });

  const input = JSON.parse(raw || '{}');
  const sessionId = input.session_id;
  if (!sessionId) return;

  let entry = null;

  if (input.hook_event_name === 'UserPromptSubmit') {
    const prompt = (input.prompt || '').trim();
    if (prompt) {
      entry = { t: 'prompt', v: prompt.slice(0, 500), at: Date.now() };
    }
  } else if (input.hook_event_name === 'PostToolUse') {
    const file = input.tool_input?.file_path;
    const command = input.tool_input?.command;
    if (file) {
      entry = { t: 'file', v: file, at: Date.now() };
    } else if (typeof command === 'string' && command.trim()) {
      // Shell commands are recorded because most work never touches Edit/Write: a
      // plugin written with a heredoc, a WP-CLI call, a deploy. Two whole sessions
      // recorded zero files and their summaries could only describe what was *asked
      // for*, never what was built.
      const cleaned = redact(command.trim());
      if (cleaned) entry = { t: 'cmd', v: cleaned.slice(0, 300), at: Date.now() };
    }
  }

  if (!entry) return;

  // Path traversal guard: session_id comes from the harness, but it lands in a
  // filename, so don't take it on trust.
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) return;

  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(DIR, `${safeId}.jsonl`), `${JSON.stringify(entry)}\n`, {
    mode: 0o600,
  });
};

// Never let a logging hook disrupt a session. Failing silently is correct here:
// nothing downstream can act on the error, and a visible one would just be noise.
main().catch(() => {}).finally(() => process.exit(0));
