-- Why are GitHub task titles "repo — N commits" instead of a real summary?
-- Run: psql -U <user> -d <db> -f diagnose_ai.sql
--
-- "taskflow-ai — 6 commits" is the FALLBACK in githubService.summariseDay — it only
-- appears when the AI call threw. ai_usage records every attempt, so this says which
-- provider was tried, which model, and the exact error.

\echo ''
\echo '=== 1. Recent AI calls: what failed and why ==='
SELECT created_at, task_kind, provider, model, tier, ok, error_code, latency_ms, fell_back
FROM ai_usage
ORDER BY created_at DESC
LIMIT 25;

\echo ''
\echo '=== 2. Failures grouped — error_code is the answer ==='
\echo '    401 = bad/missing key for that provider'
\echo '    400 = the model id is wrong, or the request shape is rejected'
\echo '    (no rows at all = the call never reached a provider, e.g. no key configured)'
SELECT provider, model, error_code, count(*) AS failures, max(created_at) AS last_seen
FROM ai_usage
WHERE NOT ok
GROUP BY provider, model, error_code
ORDER BY failures DESC;

\echo ''
\echo '=== 3. Did anything succeed? (which provider is actually working) ==='
SELECT provider, model, count(*) AS calls,
       avg(latency_ms)::int AS avg_ms,
       sum(cost_usd)::numeric(10,4) AS cost_usd
FROM ai_usage
WHERE ok
GROUP BY provider, model
ORDER BY calls DESC;

\echo ''
\echo '=== 4. The commit rollup specifically (this is what titles the tasks) ==='
SELECT created_at, provider, model, ok, error_code
FROM ai_usage
WHERE task_kind = 'commit_rollup'
ORDER BY created_at DESC
LIMIT 10;

\echo ''
\echo '=== 5. Duplicate GitHub tasks from the id change ==='
\echo '    old format gh-{repoId}-{date}  = orphan, frozen, never updates again'
\echo '    new format gh-{userId}-{repoId}-{date} = live, rebuilt every scan'
SELECT id,
       CASE WHEN id ~ '^gh-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN 'OLD (delete)'
            ELSE 'new (keep)' END AS format,
       title
FROM tasks
WHERE id LIKE 'gh-%'
ORDER BY title, format;
