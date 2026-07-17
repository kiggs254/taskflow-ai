import test from 'node:test';
import assert from 'node:assert/strict';

process.env.API_SECRET = 'test';
process.env.DATABASE_URL = 'postgres://invalid:5432/invalid';

const { matchWorkPath, parseGitRemote } = await import('../src/services/agentService.js');

/**
 * matchWorkPath IS the privacy boundary. If it returns a workspace for a personal
 * folder, that session's prompts end up in a report that may go to a team Slack
 * channel. Failing closed (null) is always the safe direction.
 */

const RULES = [
  { path: '/Users/me/Projects', workspace: 'job' },
  { path: '/Users/me/Projects/side-hustle', workspace: 'personal' },
  { path: '/Users/me/Clients', workspace: 'freelance' },
];

test('a folder inside a work root matches', () => {
  assert.equal(matchWorkPath('/Users/me/Projects/taskflow', RULES), 'job');
  assert.equal(matchWorkPath('/Users/me/Clients/acme/site', RULES), 'freelance');
});

test('the work root itself matches', () => {
  assert.equal(matchWorkPath('/Users/me/Projects', RULES), 'job');
});

test('longest prefix wins, so a sub-folder can override its parent', () => {
  assert.equal(matchWorkPath('/Users/me/Projects/side-hustle/app', RULES), 'personal');
});

test('an unlisted folder is NOT work — nothing is logged', () => {
  assert.equal(matchWorkPath('/Users/me/personal-notes', RULES), null);
  assert.equal(matchWorkPath('/tmp/scratch', RULES), null);
  assert.equal(matchWorkPath('/Users/me', RULES), null);
});

test('matching is path-boundary aware, not a bare string prefix', () => {
  // The bug this guards: '/Users/me/Projects-personal' starts with '/Users/me/Projects'
  // as a *string*, and would leak a personal folder into 'job'.
  assert.equal(matchWorkPath('/Users/me/Projects-personal/diary', RULES), null);
  assert.equal(matchWorkPath('/Users/me/ProjectsX', RULES), null);
});

test('no rules configured means nothing is ever work', () => {
  assert.equal(matchWorkPath('/Users/me/Projects/taskflow', []), null);
  assert.equal(matchWorkPath('/Users/me/Projects/taskflow', undefined), null);
});

test('bad input fails closed', () => {
  assert.equal(matchWorkPath(null, RULES), null);
  assert.equal(matchWorkPath('', RULES), null);
  assert.equal(matchWorkPath(undefined, RULES), null);
});

test('relative and untidy paths are normalised before matching', () => {
  assert.equal(matchWorkPath('/Users/me/Projects/taskflow/../taskflow', RULES), 'job');
  assert.equal(matchWorkPath('/Users/me/Projects//taskflow', RULES), 'job');
  // Traversal that escapes the root must not match.
  assert.equal(matchWorkPath('/Users/me/Projects/../secrets', RULES), null);
});

/**
 * parseGitRemote feeds the "is this already covered by GitHub" check. A remote that
 * fails to parse means we log work GitHub also logs — a duplicate, not a leak.
 */

test('parses every remote form git actually emits', () => {
  const want = { owner: 'kiggs254', name: 'taskflow-ai' };
  assert.deepEqual(parseGitRemote('git@github.com:kiggs254/taskflow-ai.git'), want);
  assert.deepEqual(parseGitRemote('git@github.com:kiggs254/taskflow-ai'), want);
  assert.deepEqual(parseGitRemote('https://github.com/kiggs254/taskflow-ai.git'), want);
  assert.deepEqual(parseGitRemote('https://github.com/kiggs254/taskflow-ai'), want);
  assert.deepEqual(parseGitRemote('ssh://git@github.com/kiggs254/taskflow-ai.git'), want);
  assert.deepEqual(parseGitRemote('https://user@github.com/kiggs254/taskflow-ai.git'), want);
  assert.deepEqual(parseGitRemote('  git@github.com:kiggs254/taskflow-ai.git\n'), want);
});

test('handles nested groups and self-hosted hosts', () => {
  assert.deepEqual(parseGitRemote('git@gitlab.com:group/sub/proj.git'), {
    owner: 'group',
    name: 'sub/proj',
  });
});

test('returns null rather than guessing', () => {
  assert.equal(parseGitRemote(''), null);
  assert.equal(parseGitRemote(null), null);
  assert.equal(parseGitRemote('not-a-remote'), null);
  assert.equal(parseGitRemote(undefined), null);
});
