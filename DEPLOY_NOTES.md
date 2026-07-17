# Deploy notes — Git tracking, AI upgrade, daily report, perf

Read the first section before deploying. One step is destructive if skipped.

## 1. Migrations (run in this order)

```bash
cd backend
psql -U <user> -d <db> -f migration_add_subtasks_to_tasks.sql        # was corrupt; see below
psql -U <user> -d <db> -f migration_add_processed_gmail_messages.sql # ⚠ read below
psql -U <user> -d <db> -f migration_add_draft_tasks_source_unique.sql
psql -U <user> -d <db> -f migration_add_completed_at_index.sql
psql -U <user> -d <db> -f migration_add_ai_usage.sql
psql -U <user> -d <db> -f migration_add_github_integration.sql
psql -U <user> -d <db> -f migration_add_user_report_settings.sql
psql -U <user> -d <db> -f migration_add_analytics_narrative.sql
```

All are idempotent and safe to re-run (verified against a real Postgres).

### ⚠ `migration_add_processed_gmail_messages.sql` — do not skip the backfill

It creates the dedup ledger **and** seeds it from your existing drafts/tasks. The
seeding is not optional. With an empty ledger, every historical email looks
unprocessed and the first scan after deploy would recreate **every task you have ever
had from Gmail, at once** — shipping the duplicate bug's worst case as its own fix.

Sanity check straight after:

```sql
SELECT outcome, count(*) FROM processed_gmail_messages GROUP BY outcome;
```

If that returns zero rows on a database with Gmail history, **stop** and investigate
before letting the scanner run.

### `migration_add_subtasks_to_tasks.sql`

This file previously began with a stray `finsi`, making it invalid SQL that failed on
line 1. If subtasks have never worked for you, that is why — it likely never applied.
It is fixed and safe to run now.

## 2. Environment

New backend vars — GitHub (all three required for the integration to appear):

```
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...          # from the app URL: github.com/apps/<slug>
GITHUB_APP_PRIVATE_KEY=...   # the .pem contents, or base64 of the .pem
```

**On `GITHUB_APP_PRIVATE_KEY`.** It's a multi-line PKCS#1 PEM and Coolify's env field
flattens multi-line values, which corrupts it. A corrupted key surfaces as
`error:1E08010C:DECODER routines::unsupported` — that reads like a GitHub failure but
is purely local: OpenSSL can't parse the key, so the app JWT can never be signed and
the repo list always comes back empty.

Pristine, `\n`-escaped, space-flattened, and CRLF forms are all normalized now. If in
doubt, sidestep the field entirely by base64-encoding the whole file — this is
accepted directly:

```bash
base64 -i your-app.private-key.pem | tr -d '\n'
```

Without them the Settings panel explains it is unconfigured and the scanner stays off.

Optional AI overrides (defaults shown). These exist because a wrong model id 400s
every call — this turns a redeploy into an env edit:

```
OPENAI_MODEL_FAST=gpt-4o-mini
OPENAI_MODEL_SMART=gpt-4o
DEEPSEEK_MODEL_FAST=deepseek-v4-flash
DEEPSEEK_MODEL_SMART=deepseek-v4-pro
AI_PRIMARY_PROVIDER=openai
```

**Leave `AI_PRIMARY_PROVIDER=openai` initially.** DeepSeek is the fallback. Flip it to
`deepseek` only once `ai_usage` shows parity:

```sql
SELECT provider, model, count(*), avg(latency_ms)::int AS ms, sum(cost_usd)::numeric(10,4)
FROM ai_usage WHERE ok GROUP BY provider, model;
```

Email reports need the existing `SMTP_*` vars. If SMTP is unset, the email channel
fails on its own and Slack still goes out.

## 3. Creating the GitHub App

Settings → Developer settings → GitHub Apps → New.

- **Callback URL:** `https://<backend>/api/github/callback`
- **Setup URL:** same, and tick *Redirect on update*
- **Permissions:** `Repository → Contents: Read-only`, `Repository → Metadata: Read-only`
- **Where can this be installed:** Only on this account
- Generate a private key → `GITHUB_APP_PRIVATE_KEY`

Read-only is deliberate. A classic OAuth app cannot read private repos without the
`repo` scope, which is read **and write** to every private repo you own. A task
manager should not hold write access to your source code.

## 4. Verifying after deploy

- **Work→Personal bug:** on the Work tab add "call the vendor about the invoice" five
  times. All five must stay in Work. (Previously nondeterministic — repeat it.)
- **Email duplicates:** scan → **reject** a draft → scan again. It must not come back.
  That is the exact case that used to fail: rejecting re-armed the bug.
- **GitHub:** connect, pick a repo, push 3 commits, *Scan Now* → one completed task
  with 3 subtasks. Scan again → no duplicate. Push a 4th → the same task updates.
- **Daily report:** Settings → *Send test report*. Don't wait for 16:30.
- **Perf:** DevTools → Performance, 200+ tasks. A 15s poll that changes nothing must
  now produce **no re-render**. Network should show no `cdn.tailwindcss.com`.

## 5. Rollback

- AI: set `AI_PRIMARY_PROVIDER` / `*_MODEL_*` back — no redeploy needed.
- GitHub: unset `GITHUB_APP_ID`; the scanner and panel disable themselves.
- Report: `UPDATE user_report_settings SET email_enabled = false, slack_enabled = false;`
- The migrations are all additive; none drop or rewrite existing columns.
