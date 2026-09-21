import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRepoCommits } from '../src/services/githubService.js';

/**
 * The scanner must pick up commits on EVERY branch, not just the default one -- work on
 * a feature branch used to be invisible until it merged to main. fetchRepoCommits
 * enumerates branches and unions their commits, deduped by SHA. Driven by a fake client
 * so it needs no network.
 */

const repo = { owner: 'o', name: 'r', default_branch: 'main' };

// A fake GitHub client. `branches` maps branch -> array of {sha} commits.
const makeClient = (branches, { failRateLimitOn } = {}) => {
  const requests = [];
  return {
    requests,
    request: async (url) => {
      requests.push(url);
      if (url.includes('/branches')) {
        return { data: Object.keys(branches).map((name) => ({ name })), link: null };
      }
      const m = url.match(/[?&]sha=([^&]+)/);
      const branch = decodeURIComponent(m[1]);
      if (failRateLimitOn && branch === failRateLimitOn) {
        const e = new Error('rate limited');
        e.rateLimited = true;
        throw e;
      }
      return { data: branches[branch] || [], link: null };
    },
  };
};

const opts = { logins: ['me'], sinceIso: '2026-08-05T00:00:00Z' };

test('commits from a feature branch are picked up, not just the default branch', async () => {
  const client = makeClient({
    main: [{ sha: 'a1' }],
    'feature/x': [{ sha: 'b2' }, { sha: 'b3' }],
  });
  const { commits, branchOf } = await fetchRepoCommits(client, repo, opts);
  assert.deepEqual(commits.map((c) => c.sha).sort(), ['a1', 'b2', 'b3']);
  assert.equal(branchOf.get('b2'), 'feature/x', 'the branch is attributed to the commit');
  assert.equal(branchOf.get('a1'), 'main');
});

test('a SHA on multiple branches is counted once, attributed to the first branch seen', async () => {
  const client = makeClient({
    main: [{ sha: 'shared' }],
    'feature/y': [{ sha: 'shared' }, { sha: 'only-y' }],
  });
  const { commits } = await fetchRepoCommits(client, repo, opts);
  assert.equal(commits.filter((c) => c.sha === 'shared').length, 1, 'no double count');
  assert.deepEqual(commits.map((c) => c.sha).sort(), ['only-y', 'shared']);
});

test('the commits request targets the branch via ?sha=<branch>', async () => {
  const client = makeClient({ 'release/2.0': [{ sha: 'r1' }] });
  await fetchRepoCommits(client, repo, opts);
  assert.ok(
    client.requests.some((u) => u.includes('/commits') && u.includes(`sha=${encodeURIComponent('release/2.0')}`)),
    'branch name is passed as the sha ref'
  );
});

test('a rate-limit on any branch aborts the whole repo scan', async () => {
  const client = makeClient(
    { main: [{ sha: 'a1' }], 'feature/z': [{ sha: 'z9' }] },
    { failRateLimitOn: 'feature/z' }
  );
  await assert.rejects(() => fetchRepoCommits(client, repo, opts), /rate limited/);
});

test('a repo reporting no branches still scans its default branch', async () => {
  const client = {
    request: async (url) => {
      if (url.includes('/branches')) return { data: [], link: null };
      return { data: [{ sha: 'd1' }], link: null };
    },
  };
  const { commits } = await fetchRepoCommits(client, repo, opts);
  assert.deepEqual(commits.map((c) => c.sha), ['d1']);
});

/**
 * Author filtering, and the bug that made it necessary.
 *
 * `github_login` used to be `repos[0].owner.login`. Transfer the repos to an
 * organisation and that becomes the ORG name -- `&author=<org>` matches nothing,
 * because an org cannot author a commit, and commit tracking stopped with no error
 * anywhere. The owner of an installation and the author of a commit are now separate
 * things, and the author filter is a *set* spanning every connected account.
 */

test('one known login is filtered server-side, via ?author=', async () => {
  const client = makeClient({ main: [{ sha: 'a1' }] });
  await fetchRepoCommits(client, repo, { logins: ['kiggs254'], sinceIso: 'S' });
  const commitUrl = client.requests.find((u) => u.includes('/commits'));
  assert.ok(commitUrl.includes('author=kiggs254'), 'a single login is passed to GitHub');
});

test('no known login means no filter at all, rather than a filter matching nothing', async () => {
  const client = makeClient({ main: [{ sha: 'a1', author: { login: 'someone-else' } }] });
  const { commits } = await fetchRepoCommits(client, repo, { logins: [], sinceIso: 'S' });
  const commitUrl = client.requests.find((u) => u.includes('/commits'));
  assert.ok(!commitUrl.includes('author='), 'no author param');
  assert.deepEqual(commits.map((c) => c.sha), ['a1'], 'over-report visibly rather than under-report silently');
});

test('several connected accounts drop the server filter and match locally', async () => {
  const client = makeClient({
    main: [
      { sha: 'mine-a', author: { login: 'kiggs254' } },
      { sha: 'theirs', author: { login: 'a-colleague' } },
      { sha: 'mine-b', author: { login: 'KIGGS-WORK' } }, // case-insensitive
      { sha: 'unlinked', author: null },                  // email not on any account
    ],
  });
  const { commits } = await fetchRepoCommits(client, repo, {
    logins: ['kiggs254', 'kiggs-work'],
    sinceIso: 'S',
  });
  const commitUrl = client.requests.find((u) => u.includes('/commits'));
  assert.ok(!commitUrl.includes('author='), 'author= takes one value, so it is unusable here');
  assert.deepEqual(
    commits.map((c) => c.sha).sort(),
    ['mine-a', 'mine-b'],
    'both of my logins match; a colleague and an unlinked commit do not'
  );
});

test('an org name is not a commit author, so it never reaches the filter', async () => {
  // What refreshRepos must never do: take the repo owner as the author. Asserted here
  // as the behaviour it produces -- the org authors nothing, so filtering by it yields
  // an empty day, which is exactly the silent failure this replaced.
  const client = makeClient({
    main: [{ sha: 'a1', author: { login: 'kiggs254' } }],
  });
  const { commits } = await fetchRepoCommits(client, repo, {
    logins: ['e-biz-org', 'kiggs254'],
    sinceIso: 'S',
  });
  assert.deepEqual(commits.map((c) => c.sha), ['a1'], 'the real author still matches');
});
