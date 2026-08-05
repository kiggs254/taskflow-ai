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

const opts = { login: 'me', sinceIso: '2026-08-05T00:00:00Z' };

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
