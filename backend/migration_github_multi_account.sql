-- Migration: multiple GitHub accounts per user, and a commit-author login that
-- survives a repo being transferred to an organisation.
-- Run: psql -U <user> -d <db> -f migration_github_multi_account.sql
--
-- Two problems, one shape:
--
-- 1. `UNIQUE(user_id)` on github_integrations allowed exactly one installation per
--    user, so connecting a second GitHub account (or an org alongside a personal
--    account) overwrote the first -- `ON CONFLICT (user_id) DO UPDATE SET
--    installation_id` silently replaced it, and the old account's repos were left
--    pointing at an installation that no longer existed.
--
-- 2. `github_login` was set to `repos[0].owner.login` and used as the `&author=`
--    filter on the commits API. Transfer the repos to an org and that becomes the
--    ORG name -- an org cannot author a commit, so the filter matched nothing and
--    commit tracking stopped without a single error. The owner of an installation
--    and the author of a commit are different things and now have different columns.

BEGIN;

-- --------------------------------------------------------------------------
-- github_integrations: one row per connected account, not per user.
-- --------------------------------------------------------------------------

-- Named by Postgres' default for a UNIQUE(user_id) on this table; guard anyway so
-- the migration is safe to re-run and safe on a hand-edited schema.
ALTER TABLE github_integrations DROP CONSTRAINT IF EXISTS github_integrations_user_id_key;

ALTER TABLE github_integrations
    -- The account the app is installed on: a user or an organisation. Display only.
    ADD COLUMN IF NOT EXISTS account_login VARCHAR(255),
    -- 'User' | 'Organization', straight from GitHub.
    ADD COLUMN IF NOT EXISTS account_type VARCHAR(20),
    -- The login whose commits count as this user's work, i.e. the `&author=` filter.
    -- Derived from the account only when it IS a user; for an org it is inherited
    -- from a personal installation or set by hand, and NEVER the org name.
    ADD COLUMN IF NOT EXISTS author_login VARCHAR(255),
    -- Set when GitHub stops returning a repo for this installation, so the UI can
    -- say "the app lost access" instead of the repo silently going quiet.
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Carry the old value across. It was only ever right when the installation was on a
-- personal account, which is also the only case where it equals the author.
UPDATE github_integrations
   SET account_login = COALESCE(account_login, github_login)
 WHERE github_login IS NOT NULL;

-- Deliberately NOT copied into author_login. The whole point of this migration is
-- that the old column conflated the two, so trusting it here would carry the bug
-- forward. refreshRepos re-derives it from the installation account on the next run,
-- and leaves it null (= no author filter, ingest everything) rather than guessing.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_github_integrations_user_installation
    ON github_integrations(user_id, installation_id)
    WHERE installation_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- github_repos: remember which installation grants access to each repo.
-- --------------------------------------------------------------------------

ALTER TABLE github_repos
    ADD COLUMN IF NOT EXISTS installation_id BIGINT,
    -- Non-destructive tombstone. A repo that vanishes from its installation's list
    -- (transferred away, access revoked) must keep its row: repo_id is the identity
    -- behind processed_commits and every `gh-{uid}-{repoId}-...` task id, and
    -- `selected` is the user's choice. Deleting it would re-ingest the whole history
    -- if the repo ever came back.
    ADD COLUMN IF NOT EXISTS access_lost_at TIMESTAMP WITH TIME ZONE;

-- Backfill: before this there was one installation per user, so every repo belongs
-- to it.
UPDATE github_repos r
   SET installation_id = i.installation_id
  FROM github_integrations i
 WHERE i.user_id = r.user_id
   AND r.installation_id IS NULL
   AND i.installation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_github_repos_installation
    ON github_repos(user_id, installation_id);

COMMIT;
