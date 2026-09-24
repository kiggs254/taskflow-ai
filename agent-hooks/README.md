# Logging Claude Code work to TaskFlow

Turns work you do in Claude Code into completed tasks — for everything Git doesn't
already capture (WordPress plugins, ops, scripts, any folder that isn't a tracked
repo).

Commits in repos tracked by the GitHub integration are **skipped**, because those
already become tasks. Nothing is counted twice.

## What gets logged

Only sessions inside folders you list in **Settings → Claude Code**. Everything else
— personal projects, anything unlisted — sends **nothing at all**. The check happens
on your machine, before any network call, so a personal session's prompts never leave
it.

The most specific folder wins, so you can nest a personal folder inside a work one:

```
/Users/you/Projects               -> job
/Users/you/Projects/side-hustle   -> personal   (overrides the parent)
```

## Setup

**1. Generate a token** in Settings → Claude Code. It's shown once and stored hashed.
It only works for logging work — it can't read your tasks or change settings, and you
can revoke it.

**2. Give the hook its credentials.** Write a config file — this is the reliable way,
because Claude Code spawns hooks **non-interactively**, so a shell profile like
`~/.zshrc` is *not* sourced and its `export`s are invisible to the hook:

```bash
mkdir -p ~/.taskflow && chmod 700 ~/.taskflow
cat > ~/.taskflow/config.json <<'JSON'
{ "apiUrl": "https://your-backend.example.com/api", "token": "tf_..." }
JSON
chmod 600 ~/.taskflow/config.json
```

Environment variables (`TASKFLOW_API_URL`, `TASKFLOW_TOKEN`) still work and take
precedence if the hook happens to inherit them, but don't rely on a shell profile for
them — that's the trap that makes SessionEnd silently post nothing while session logs
pile up under `~/.taskflow/sessions/` and no `~/.taskflow/policy.json` ever appears.

**3. Install the hooks** (`taskflow-flush.mjs` is a command you run, not a registered
hook, but it lives alongside them):

```bash
mkdir -p ~/.claude/hooks
cp agent-hooks/taskflow-*.mjs ~/.claude/hooks/
chmod +x ~/.claude/hooks/taskflow-*.mjs
```

**4. Register them** in `~/.claude/settings.json` (note the `Bash` in the matcher — see
"What is recorded" below):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/taskflow-record.mjs" }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "~/.claude/hooks/taskflow-record.mjs" }]
      }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/taskflow-session-end.mjs" }] }
    ]
  }
}
```

**5. Add your work folders** in Settings. Until you do, nothing is logged.

## How it works

| Hook | When | What |
|---|---|---|
| `taskflow-record.mjs` | every prompt, every Edit/Write, every Bash command | Appends to `~/.taskflow/sessions/<id>.jsonl` |
| `taskflow-session-end.mjs` | session ends | Checks the folder, posts if it's work, deletes the log |
| `taskflow-flush.mjs` | you run it | Posts a snapshot mid-session, **keeps** the log |

The prompts describe intent, the file paths show where it landed; the server turns
the pair into one line like `wp-plugin — fixed the checkout hook and added tests`.
Sessions in the same project on the same day merge into one task, one subtask each.

**Why record as we go** rather than read the transcript at the end: the Claude Code
docs are explicit that the transcript format "is internal to Claude Code and changes
between versions, so scripts that parse these files directly can break on any
release." There's also no built-in list of files a session edited. Recording as it
happens is the documented approach — and unlike `git diff` it works for folders that
aren't repos at all, which is the entire point here.

`SessionEnd` can't block and its exit code is ignored, so these can never delay or
break session exit. They fail silently by design.

## Posting before the session ends

`SessionEnd` is an event, not a timer. It fires on `/clear`, on logout, and on Ctrl-D
at the prompt — and **never** if you just leave the session open or the terminal is
killed outright. A session you keep open for three days logs nothing for three days.

To post what a session has done so far — from anywhere:

```bash
~/.claude/hooks/taskflow-flush.mjs          # the most recent session in a work folder
~/.claude/hooks/taskflow-flush.mjs --today  # every work session from today
~/.claude/hooks/taskflow-flush.mjs --auto   # quiet, changed sessions only (for a timer)
~/.claude/hooks/taskflow-flush.mjs --all    # every work session on disk
~/.claude/hooks/taskflow-flush.mjs --list   # work sessions on disk; -> marks the pick
```

One session becomes one task (`agent-{uid}-{session}-{day}`), so a day with three
sessions posts three entries rather than merging them into one vague line. `--today`
posts oldest first, so they land in the order the work happened, and one failure
doesn't abandon the rest. Each costs its own summary call, which is why the batch is
opt-in rather than what a bare run does.

### Making it automatic

`SessionEnd` only fires on `/clear`, exit or Ctrl-D. A session left open never ends — and
in a GUI that is most of them, so sessions sit unposted for days. The timer closes that
gap:

```bash
sed "s#REPLACE_HOME#$HOME#g" agent-hooks/com.taskflow.autoflush.plist > ~/Library/LaunchAgents/com.taskflow.autoflush.plist
launchctl load ~/Library/LaunchAgents/com.taskflow.autoflush.plist
```

Every 15 minutes it posts work sessions that have been **quiet for 10 minutes** and have
**changed since they were last posted**. An unchanged session costs nothing — no request,
no AI call — because `~/.taskflow/flushed.json` records the log mtime at each successful
post. A failed post is deliberately not recorded, so it retries. Re-posting is safe:
`agent_sessions` upserts on `(user, session, day)`, so a later flush updates the same
task rather than creating another.

Check on it with `tail ~/.taskflow/autoflush.log`, or run `taskflow-flush.mjs --auto` by
hand to see what it would do.

**Only sessions inside your work folders are ever considered.** Everything else is not
listed, not posted, and not touched — naming one explicitly is refused. It is the same
allowlist the SessionEnd hook enforces, applied here so the command can be run from any
directory without picking up an unrelated project. With one work folder configured,
`taskflow-flush.mjs` from anywhere means "post my work-folder session".

A session is matched to its work folder by **the directory the session runs in**, read
from Claude Code's own project folder (`~/.claude/projects/<slugged-path>/`), with
edited files only as a fallback. Going by edited files alone does not work: a session
working in a work folder often edits nothing inside it — scratch files land in the
session's temp directory, which is not on the allowlist — so real work was classified
as personal and posted nothing.

If several work folders are configured, a session in the folder you are standing in
wins over a newer one elsewhere; otherwise the most recent work session is used.

It runs `taskflow-session-end.mjs --keep`. The `--keep` is load-bearing: `agent_sessions`
upserts on `(user_id, session_id, day)` and **replaces** the row's prompts, summary and
changed paths. A flush that consumed the log would leave the eventual session-end post
carrying only the work done *after* the flush — silently overwriting everything before
it. With the log kept, the final post is cumulative and the row converges on the whole
session.

Re-flushing is safe and idempotent (same session, same day, same row), but each one
costs a `smart`-tier AI call to re-summarise. Flush when you finish something, not on a
loop.

## Checking it works

Run a session in a work folder, then look at Completed. To see the decision the
server made:

```bash
curl -s -X POST "$TASKFLOW_API_URL/agent/log-work" \
  -H "Authorization: Bearer $TASKFLOW_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-test","projectDir":"'"$PWD"'","changedPaths":["'"$PWD"'/x.php"],"prompts":["testing taskflow"],"startedAt":'"$(date +%s000)"',"endedAt":'"$(date +%s000)"'}'
```

Responses are always 200 — these are outcomes, not errors, and that is precisely why the
flush prints the server's answer rather than its own exit code. `SessionEnd` ignores exit
codes, so the hook swallows everything and exits 0 whatever happens; a caller that trusts
that reports "posted" for a session the server refused outright:

| `reason` | Meaning |
|---|---|
| `not_a_work_path` | Folder isn't in your allowlist. Working as intended. |
| `covered_by_github` | You committed to a tracked repo; GitHub logs it instead. |
| `agent_logging_disabled` | Toggled off in Settings. |

## What is recorded, and what is stripped

Three kinds of entry: the prompts you type, the paths of files opened with Edit/Write,
and the shell commands that ran.

Shell commands are included because **most work never touches Edit/Write** — a plugin
written with a heredoc, a WP-CLI call, a deploy. Two real sessions here each shipped a
plugin and recorded *zero* files, so their summaries could only describe what was asked
for, never what was built.

Every command passes through `redact()` in `taskflow-record.mjs` **before it is written
to disk**, so a credential is never persisted locally either, let alone sent. It strips
`KEY=`/`--password`/`-p<value>` style assignments and flags, `Authorization:` headers,
credentials inside URLs (`postgres://user:pass@host`), known key prefixes (`sk-`, `ghp_`,
`AKIA…`, `cfat_`, `tf_`, JWTs), PEM blocks, and any bare 32-char-plus high-entropy blob.
Writing to a `.env` file records only that it happened.

It is deliberately over-eager: a redacted flag costs a slightly vaguer summary, a missed
key is a leaked credential. It cannot be complete — a secret in a shape it does not
anticipate will pass through — which is why the work-folder allowlist still gates
everything. Commands from folders you have not listed are never recorded at all.

`backend/test/redactCommand.test.js` runs against this file's own text, so an installed
copy that drifts from the tested one is caught.

## Privacy

- The folder check runs locally against a cached policy (`~/.taskflow/policy.json`,
  refreshed hourly). Non-work sessions make **no request at all**.
- Prompts for work sessions go to your own TaskFlow backend and nowhere else.
- The local log is deleted at session end either way.
- Shell commands are redacted before they touch the disk — see "What is recorded" above.
- The token is scoped to `/api/agent` only, stored hashed, and revocable.
