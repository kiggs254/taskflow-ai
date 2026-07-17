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
    if (file) {
      entry = { t: 'file', v: file, at: Date.now() };
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
