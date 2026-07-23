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

**3. Install the hooks:**

```bash
mkdir -p ~/.claude/hooks
cp agent-hooks/taskflow-*.mjs ~/.claude/hooks/
chmod +x ~/.claude/hooks/taskflow-*.mjs
```

**4. Register them** in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/taskflow-record.mjs" }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
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
| `taskflow-record.mjs` | every prompt, every Edit/Write | Appends to `~/.taskflow/sessions/<id>.jsonl` |
| `taskflow-session-end.mjs` | session ends | Checks the folder, posts if it's work, deletes the log |

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

## Checking it works

Run a session in a work folder, then look at Completed. To see the decision the
server made:

```bash
curl -s -X POST "$TASKFLOW_API_URL/agent/log-work" \
  -H "Authorization: Bearer $TASKFLOW_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-test","projectDir":"'"$PWD"'","changedPaths":["'"$PWD"'/x.php"],"prompts":["testing taskflow"],"startedAt":'"$(date +%s000)"',"endedAt":'"$(date +%s000)"'}'
```

Responses are always 200 — these are outcomes, not errors:

| `reason` | Meaning |
|---|---|
| `not_a_work_path` | Folder isn't in your allowlist. Working as intended. |
| `covered_by_github` | You committed to a tracked repo; GitHub logs it instead. |
| `agent_logging_disabled` | Toggled off in Settings. |

## Privacy

- The folder check runs locally against a cached policy (`~/.taskflow/policy.json`,
  refreshed hourly). Non-work sessions make **no request at all**.
- Prompts for work sessions go to your own TaskFlow backend and nowhere else.
- The local log is deleted at session end either way.
- The token is scoped to `/api/agent` only, stored hashed, and revocable.
