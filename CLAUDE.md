# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TASKFLOW.AI is a gamified (XP/levels/streaks) task manager for developers. Two independently deployed halves live in one repo:

- **Frontend** (repo root): React 19 + Vite + TypeScript, deployed to Netlify.
- **Backend** (`backend/`): Node/Express + PostgreSQL, ESM, deployed to Coolify.

## Commands

```bash
# Frontend (repo root)
npm install
npm run dev        # Vite dev server — NOTE: also port 3000, see "Port collision"
npm run build      # -> dist/
npm run preview

# Backend
cd backend
npm install
npm run dev        # node --watch src/server.js
npm start
psql -U <user> -d <db> -f schema.sql   # initial schema
psql -U <user> -d <db> -f migration_*.sql  # migrations are manual, run individually
```

There is **no linter**. `npm run build` still does **not** typecheck — run `npm run typecheck` (frontend, `tsc --noEmit`) separately. `tsconfig.json` scopes `include` to the frontend; without that it globs `backend/node_modules` and reports a parse error inside `googleapis`.

`cd backend && npm test` runs `node --test` over `backend/test/*.test.js` (time/timezone, OAuth state signing, AI model config, AI schema coercion, and `callAI` retry/fallback against mock HTTP servers). It needs no database and no network. Coverage is limited to those units — **most of the app is still only verifiable by running it**.

For SQL/migration changes there is no local Postgres; `@electric-sql/pglite` (in-process Postgres via WASM) is a good way to apply `schema.sql` + migrations and assert on the result without Docker.

### Port collision

Vite dev server is pinned to **port 3000** (`vite.config.ts`), and the backend also defaults to **port 3000**. They cannot both use the default. Run the backend on another port (`PORT=3001`) and point the frontend at it via `VITE_API_BASE_URL=http://localhost:3001/api` in `.env.local`.

## Environment

- Frontend `.env.local`: `VITE_API_BASE_URL` only. It is injected via Vite's `define` as `process.env.VITE_API_BASE_URL` (not `import.meta.env`) — `vite.config.ts` maps it explicitly. Adding a new frontend env var requires adding it to `define` too.
- Backend `.env`: see `backend/.env.example`. `DATABASE_URL`, `API_SECRET`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` are treated as required; Gmail/Telegram/Slack/SMTP/`ENCRYPTION_KEY` are needed only for those integrations.
- Scheduled jobs run only when `NODE_ENV=production` or `ENABLE_JOBS=true`.

## Architecture

### API convention: query-param actions, not REST

The core task/auth API is **not** RESTful. The frontend calls a single endpoint with an `action` query param:

```
POST /api?action=login      GET /api?action=get_tasks     POST /api?action=sync_tasks
```

`services/apiService.ts` builds every URL as `${API_BASE}?action=${action}`. Server-side these are handled by `backend/src/routes/queryParams.js`, a giant if/else on `req.query.action` that calls `next()` when nothing matches so requests fall through to direct routes. **Middleware order in `server.js` is load-bearing** — `queryParamRoutes` is mounted before `taskRoutes` so auth actions resolve first. Newer subsystems (AI, Gmail, Telegram, Slack, draft tasks) *are* conventional REST under `/api/ai/*`, `/api/gmail/*`, etc.

Both `apiService.ts` and `geminiService.ts` normalize `API_BASE` to always end in `/api`, so `VITE_API_BASE_URL` works with or without the suffix.

### Auth

Custom HMAC token, **not** JWT (`backend/src/utils/token.js`): `base64(hmac_sha256(payload) | payload)` where payload is `{uid, exp}`, 7-day expiry, signed with `API_SECRET`. Format intentionally mirrors a prior PHP implementation. `authenticate` middleware attaches `req.user = { id }`. Frontend keeps the token in `useState` mirrored to `localStorage.taskflow_token` and passes it explicitly as the first argument to every `api.*` call.

**Session expiry is handled centrally, not per-call.** `apiService.ts` shadows `fetch` for the whole module, so every `request()` and every direct `api.*` fetch runs through one wrapper that, on any `401`, fires `onSessionExpired` **once** (re-armed on the next successful response). `App.tsx` registers it to log out and show an amber "session expired" banner on the login screen. Before this, an expired 7-day token made every 15s poll retry into a 401 and flood the console forever. Don't add a bare `globalThis.fetch` path that bypasses the wrapper.

### Frontend state

`App.tsx` is a **3,800-line monolith** holding ~40 `useState` hooks and defining most views inline (`AuthScreen`, `TaskCard`, `FocusOverlay`, `DailyReset`, `AnalyticsScreen`, `SettingsScreen`, `MeetingsScreen`, `CompletedTasksScreen`). Larger/newer views live in `components/` (`TaskDetailModal` at 1,088 lines, `DraftTasksView`, the `*Settings` panels).

- **No state library, no context, no reducer** — everything is prop-drilled from `App`. Extracting a component means threading `token`, `tasks`, `stats`, and several setters by hand.
- **No router.** The `AppView` enum in `types.ts` plus conditional rendering. `FOCUS_MODE` and `DAILY_RESET` early-return and bypass the shell. Consequence: no URLs, no deep links, no back button.
- **Sync model: optimistic local update, then fire the API.** Only `addTask` rolls back on failure; update/delete/bulk-delete do not. There is no offline queue or retry — failed writes are lost, some silently.
- **Polling:** tasks re-poll every 15s and merge by id; draft-task counts poll every 15s; a snooze checker runs every 30s.

### Where the game logic actually lives

XP and levels are computed **server-side** in `backend/src/services/userService.js` (50 XP per completion; `level = floor(xp/500) + 1`). The frontend only displays them — the hardcoded `50` in `App.tsx` is a cosmetic floating-number animation that duplicates the server constant. Changing the server value without updating it makes the animation lie.

**Recurring tasks are generated client-side on completion** in `App.tsx`, not by the backend: it mints a new task with `crypto.randomUUID()`, carries `originalRecurrenceId`, and fire-and-forgets a `syncTask`. If that call fails the recurrence is lost on the next poll.

### AI

`services/geminiService.ts` is a **misnomer** — despite the filename and the `@google/genai` dependency, it holds no Gemini code. It POSTs to the backend's `/api/ai/*` endpoints. Gemini/`GEMINI_API_KEY` references in `vite.config.ts` and the import map are vestigial.

All AI runs server-side in `backend/src/services/aiService.js` via the `openai` SDK. Deepseek is driven through the same SDK with a swapped `baseURL`. Every AI endpoint takes an optional `provider` param defaulting to `openai`.

**Model ids live only in `backend/src/config/aiModels.js`** (`modelFor(provider, tier)`) — never inline them. Two tiers: `fast` (interactive, e.g. parse-task) and `smart` (cron/offline). Deepseek is on `deepseek-v4-flash` / `deepseek-v4-pro`; `deepseek-chat` is a legacy alias. Every id is env-overridable (`DEEPSEEK_MODEL_SMART` etc.) because a bad model id 400s every call — that turns a redeploy into an env-var edit. `CAPS` records that only OpenAI enforces strict JSON schemas, so Deepseek gets `json_object` + local coercion.

**Four providers, all OpenAI-compatible** (`PROVIDERS` in `aiModels.js`): `moonshot` (Kimi, the current default primary — `kimi-k2.5` fast / `kimi-k2.6` smart, base `api.moonshot.ai/v1`), `deepseek`, `openai`, and `mimo` (Xiaomi, `mimo-v2-flash`/`mimo-v2.5-pro`, base `api.xiaomimimo.com/v1`). `primaryProvider()` defaults to `moonshot`; `AI_PRIMARY_PROVIDER` overrides. An unconfigured provider (no key) is filtered out of the chain by client presence, so it degrades rather than breaks. **Kimi's thinking models take the same `thinking:{type:'enabled'|'disabled'}` field as DeepSeek and default to ENABLED** — `CAPS.moonshot.thinkingToggle` is load-bearing: without the explicit `disabled` that callAI sends, every extraction reasons first and truncates its JSON (the deepseek-v4-pro bug). MiMo's JSON/tool guarantees aren't documented, so it's `strictSchema:false` (json_object + schema-in-prompt) with no thinking field.

**New AI calls should go through `callAI()` (`services/ai/callAI.js`)**, which owns model resolution, structured output, timeouts, retry/fallback, and `ai_usage` telemetry. It classifies by HTTP status: 400 fails fast (the other provider would reject it identically), 429/5xx retry with backoff then fall back, 401 disables that provider for the process. The clients are constructed with `maxRetries: 0` deliberately — the SDK's own retries otherwise multiply against ours (3 attempts became 9 requests).

`parseTask` takes `options.userId` + `options.activeWorkspace` and grounds the model via `services/ai/context.js` (active tab, enabled workspaces, top tags, recent titles, stored `promptInstructions`). Keep the stable context first in the message array — Deepseek's prompt cache keys on the prefix. Output is coerced, not rejected, by `services/ai/taskSchema.js`, which **never returns a workspace whose tab the user has hidden**.

### Integrations → draft tasks

Gmail, Telegram, and Slack scanners (`backend/src/jobs/`, cron `* * * * *`) pull messages, run them through AI, and create **draft tasks** (`status: pending`) rather than real tasks. The user approves/rejects drafts in `DraftTasksView`; approval promotes a draft into a real task. `overdueNotifier.js` runs hourly at :15 and a daily summary at 06:00. OAuth tokens are encrypted at rest via `backend/src/utils/encryption.js` using `ENCRYPTION_KEY`.

### Styling

Tailwind v3 compiled through PostCSS: `tailwind.config.js` (theme) + `index.css` (directives, base styles, self-hosted Inter via `@fontsource/inter`), imported once from `index.tsx`. Theme changes go in `tailwind.config.js`.

**Light/dark mode is palette-driven, not `dark:` variants.** Every colour in `tailwind.config.js` is `rgb(var(--c-x) / <alpha-value>)`, and `index.css` defines the `--c-*` triples for dark (`:root`) and light (`html.light`). The app is written dark-first with literal classes (`bg-slate-800`, `text-white`, `bg-surface`), so light mode *inverts the slate scale* and flips `white`→near-black rather than adding per-element variants — adding `.light` to `<html>` re-themes the whole app with no JSX change. `services/theme.ts` owns the class toggle + persisted `taskflow_theme`; a tiny inline script in `index.html`'s `<head>` applies it before first paint (no FOUC); the Settings "Light Mode" toggle drives it. `text-white` on a saturated fill (buttons/badges/gradients) would go dark under the flip, so a reclaim block in `index.css` (more specific than the `.text-white` utility) keeps it white there. Consequence: don't introduce inline hex colours or non-slate neutral scales (`gray-*`, `zinc-*`) — they bypass the variables and won't re-theme.

Two traps this replaced, worth not reintroducing:
- The theme used to be an inline `<script>` beside `cdn.tailwindcss.com`, which shipped a CSS-in-JS compiler to the browser and rebuilt the stylesheet on every DOM mutation — i.e. on every poll tick.
- **Class names must appear as whole literals in source.** Tailwind's scanner reads file text, so ``bg-${variant}-900/20`` compiles to nothing. Interpolate complete class strings from a lookup object (see `ConfirmationModal.tsx`), never fragments.

Stay on v3 unless migrating deliberately: v4's CSS-first config and renamed utilities would silently change the rendering.

`index.html` is intentionally near-empty. **Never put a `--` inside its HTML comments** — it terminates the comment early and Vite then swallows the `<script type="module">`, producing a blank page that still builds successfully.

## Invariants worth not breaking

These encode bugs that were expensive to find. Re-introducing any of them is a regression.

- **The user's selected workspace tab always wins.** `addTask` used to overwrite `workspace` with the AI's `workspaceSuggestions`, but *only* when the active tab was `job` — so a task typed into Work could land in Personal, which is hidden by default, making it vanish. AI workspace output is **advisory**: surface it as a suggestion chip, never apply it. Integration-sourced tasks default to `'job'`, never `'personal'`.
- **Dedup is an immutable ledger, never "does an artifact still exist?"** `processed_gmail_messages` / `processed_slack_messages` record that a *message was handled*, keyed by message id, with `task_id ... ON DELETE SET NULL` so the row outlives the task. The old Gmail logic inferred "processed" from a live draft/task, so rejecting a draft or deleting a task made the email eligible for re-import — the user's "no" re-armed the bug. Check the ledger **before** any AI call, and record every outcome including `irrelevant`. `draft_tasks` has a partial unique index on `(user_id, source, source_id)`; inserts use `ON CONFLICT DO NOTHING` and return `null` when skipped.
- **The 15s poll must not re-render when nothing changed.** `pollTasks` diffs via `tasksEqual` and returns the previous array identity on a no-op; it rebuilds in the server's `created_at DESC` order and reuses unchanged task objects so memoized rows stay memoized. Don't reintroduce `JSON.stringify`-per-task diffing, and don't put `view`/`user` in its deps (that made every navigation refetch).
- **Never compute derived task lists inline.** `App.tsx` has no memoization outside the `useMemo` block near the derived state; blockers come from the precomputed `blockersByTaskId` map, never `tasks.filter(...)` inside a `.map(...)` over tasks.
- **OAuth `state` must be signed** (`utils/oauthState.js`). It used to be the bare user id, so anyone could bind their account to a victim's. Use `signState`/`verifyState`; provider is bound into the signature.
- **Timezones go through `utils/time.js`**, never a hardcoded offset. `TZ_OFFSET_MS = 3h` was duplicated across jobs and assumed a UTC server clock.
- **Don't render fabricated numbers.** `aiConfidence` is model-reported (it used to be a hardcoded 0.8/0.7 that really meant "this came from Gmail"), and Analytics compares the user against *their own* trailing 90 days — it used to hardcode `"You're in the top 10% of users this week!"` as fact. "Est. Focus Hours" is labelled as an estimate because it sums `estimatedTime`, entered *before* the work; it has never been tracked time.
- **Integration-sourced work is idempotent by construction.** GitHub commits become one task per repo per local day with the deterministic id `gh-{repoId}-{YYYY-MM-DD}`; `syncTask` upserts on that id, and the task's subtasks are rebuilt from `processed_commits` rather than from the API response. Don't switch to `crypto.randomUUID()` here — the determinism is what makes a re-scan safe.
- **The daily report is claimed before it is sent** (`user_report_settings.last_sent_on`, one atomic UPDATE). Restarts and redeploys re-fire the tick; a duplicate report in a team channel is worse than a missed one, so this is deliberately at-most-once.
- **Agent tasks are one per session, named by the work, not the folder.** The id is `agent-{uid}-{sessionId}-{day}` and `rebuildSessionTask` builds each from its single ledger row — grouping by `project_slug` merged two unrelated pieces of work done in the same catch-all folder into one run-on task. The title's project label comes from the AI (`project` field in `SUMMARY_SCHEMA`), inferred from the work; the folder slug is only a de-slugged fallback and a tag. Resuming the *same* session (same `session_id`) still updates in place. `resummariseSessions` is also the migration: it rebuilds per-session and `pruneOrphanedAgentTasks` drops the old folder-grouped task.
- **Integration day-tasks report at the subtask level, never the task level.** GitHub (`gh-{uid}-{repoId}-{day}`) and agent (`agent-{uid}-{sessionId}-{day}`) tasks are mutable daily aggregates: their `completed_at` advances to the latest commit/session all day. `getCompletedToday` must *not* include such a task via its `completed_at` (the `NOT EXISTS numeric completedAt` guard on that arm), and must display only the subtasks whose immutable `completedAt` falls in the window — otherwise a task reported at 16:30 re-qualifies the next day when one more commit extends it, and re-sends every subtask already reported. Subtask `completedAt` is commit/session time and partitions cleanly; the parent `completed_at` does not. Hand-made tasks (no numeric subtask timestamps) still report at the task level and show all subtasks.
- **The report window runs from the last send to this one, never midnight-to-midnight.** `getCompletedToday` takes `since` (= `last_sent_at`) and ends at the send instant, so consecutive reports partition time exactly. Anchored to midnight, work finished after the 16:30 send was in a day whose report had already gone, and the next day's report only looked at the next day — evening work appeared in *no* report, ever. Ending at local midnight is equally wrong: midnight is in the future at 16:30, so the windows overlap and only stay disjoint because a task can't complete in the future. `last_sent_at` must be the *same* number the claim writes (thread `atMs` through; don't call `Date.now()` twice), and `releaseReportDay` must restore the previous anchor — a failed send that advances it silently skips over work nobody received. The window is clamped to 7 days, same as the Slack scanner, or a long-quiet account's next report dumps its backlog.
- **Report/analytics channels fail independently.** `sendEmail` throws when SMTP is unconfigured and Slack returns falsy on a bad channel; one must never take down the other.
- **Weekends are skipped by not claiming, never by queueing.** The sweep returns early on Sat/Sun so `last_sent_at` stays at Friday's send, and Monday's window covers the weekend for free. There is no "defer to Monday" mechanism to build or get wrong. Use `isWeekend(tz, ms)` — a UTC host is still on Friday when Nairobi is on Saturday.
- **The report is one AI narrative per project, not a commit checklist.** `attachNarratives` (in `reportService`, the sole place AI touches the report) turns each item's in-window subtasks into a short paragraph and sets `item.project`/`item.narrative`; both the 16:30 send and the Settings preview call it so the preview is faithful. `getCompletedToday` stays pure SQL. Narratives are content-cached (hash of project + subtask titles) so repeated previews and the real send don't re-bill; a model failure falls back to the title's outcome, never blank. Renderers show `project` + `narrative` with no per-commit lines and no checkmarks — raw commit subjects (`fix(vendor-portal): …`) meant nothing to the channel.
- **Slack mrkdwn has no escape character.** These strings are full of identifiers, so never wrap model/commit text in `_italics_`: `_honour AI_PRIMARY_PROVIDER_` gives the parser four underscores to pair and it renders something nobody wrote. Bold a value you control (the project name) instead. `header` blocks are `plain_text` — a `*` there is shown literally. Respect the 50-block and 3000-char-per-section caps: over either, Slack rejects the whole post and the report silently vanishes. `buildDailySummaryMessage` is pure and tested; keep it that way, since the alternative is posting to a real channel to see what happened.
- **Truncate with `truncateAtWord`, never `slice`.** A hard cut produced titles like `added showroom s`, which read as corruption rather than abbreviation; the ellipsis is what tells the reader there was more.

## Known cruft (do not imitate; safe to remove)

- Root-level `URGENT_FIX.md`, `URGENT_HTTPS_FIX.md`, `BACKEND_ROUTING_FIX.md` are point-in-time incident notes, not current docs. `README.md`'s "Database Schema" section is out of date — `backend/schema.sql` plus the `migration_*.sql` files are authoritative.
- `sanitizeTimestamp` (converts 10-digit second timestamps to ms) is **duplicated** in two places in `App.tsx`. New timestamp fields must be added to both.
- Snooze filtering is duplicated in `App.tsx`.
- `services/geminiService.ts` is still a misnomer (no Gemini code; it calls `/api/ai/*`), as is `parseTaskWithGemini`.
- `slack_integrations.daily_report_enabled` is now superseded by `user_report_settings` and is only kept so the old frontend read doesn't break. Drop it once nothing reads it.

## Known remaining work

- **`TaskCard` is still not `React.memo`'d.** The prerequisites are done (blockers come from `blockersByTaskId`, derived lists are memoized), but the ~9 handlers `App.tsx` passes to it are recreated each render — including an inline `onAddDependency={() => setLinkingTask(task)}` — so `memo` would be a no-op until they're wrapped in `useCallback`. Do the callbacks first, then the memo; the reverse order buys nothing.
- **No list virtualization.** ~40-60 DOM nodes per card. Measure before adding it: fixed-height rows fight the layout.
- **`getUserTasks` has no pagination**, so the client still holds all history. Analytics no longer needs that (it's server-aggregated), so completed-task history is now the only reason — moving `CompletedTasksScreen` to a paginated endpoint would let the poll shrink.
