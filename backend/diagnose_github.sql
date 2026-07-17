-- GitHub integration diagnostic
-- Run:  psql -U <user> -d <db> -f diagnose_github.sql
--
-- The server logs show a contradiction that has to be resolved before trusting any
-- fix:
--     scanner  SELECT ... WHERE enabled = true      -> rows: 0
--     status   SELECT ... WHERE user_id = $1        -> rows: 1
-- The row exists but does not match `enabled = true`. This says which it is.

\echo ''
\echo '=== 1. The integration row (enabled MUST be t, installation_id MUST be set) ==='
SELECT user_id,
       installation_id,
       auth_kind,
       github_login,
       enabled,
       enabled IS NULL      AS enabled_is_null,
       installation_id IS NULL AS missing_installation,
       last_scan_at,
       created_at
FROM github_integrations;

\echo ''
\echo '=== 2. Exactly what the scanner sees (0 rows here = scanner will never run) ==='
SELECT user_id, scan_frequency, last_scan_at
FROM github_integrations
WHERE enabled = true;

\echo ''
\echo '=== 3. Cached repos (0 = the repo fetch never succeeded) ==='
SELECT count(*) AS total,
       count(*) FILTER (WHERE selected) AS selected
FROM github_repos;

SELECT repo_id, owner, name, default_branch, selected, last_polled_at
FROM github_repos
ORDER BY owner, name;

\echo ''
\echo '=== 4. Commits ingested so far ==='
SELECT count(*) AS commits,
       count(DISTINCT repo_id) AS repos,
       max(to_timestamp(committed_at/1000)) AS newest
FROM processed_commits;

\echo ''
\echo '=== 5. Column defaults -- confirms the migration applied as written ==='
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'github_integrations'
  AND column_name IN ('enabled', 'installation_id', 'auth_kind')
ORDER BY column_name;

\echo ''
\echo '=== 6. If row 1 shows enabled = f/NULL, this is the repair ==='
\echo '    UPDATE github_integrations SET enabled = true WHERE enabled IS DISTINCT FROM true;'
