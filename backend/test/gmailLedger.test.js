import test from 'node:test';
import assert from 'node:assert/strict';
import { unseenIds } from '../src/services/processedMessageService.js';

/**
 * The dedup ledger's return TYPE, which is the bug this file exists for.
 *
 * filterUnprocessedGmailIds used to return a plain array while its only caller did
 * `unprocessedIds.has(id)`. Arrays have no `.has`, so every scan that found any mail
 * threw `TypeError: unprocessedIds.has is not a function` before reaching the triage
 * loop OR the cursor update. The cursor froze at the last minute the mailbox happened
 * to be empty; every later scan re-matched the same message and threw again. The
 * pipeline never produced a single proposal, and the UI reported a calm "last checked"
 * time the whole time.
 *
 * Nothing caught it because the throw is inside the scanner's own try/catch, the job
 * only console.errors, and no test exercised the composition. So: assert the type.
 */

test('the result is a Set, because the caller calls .has on it', () => {
  const out = unseenIds(['a', 'b', 'c'], ['b']);
  assert.ok(out instanceof Set, `expected a Set, got ${out?.constructor?.name}`);
  assert.equal(typeof out.has, 'function');
});

test('.has answers correctly for seen and unseen ids', () => {
  const out = unseenIds(['a', 'b', 'c'], ['b']);
  assert.equal(out.has('a'), true);
  assert.equal(out.has('c'), true);
  assert.equal(out.has('b'), false, 'an already-processed message must not be reconsidered');
});

test('the exact call the scanner makes does not throw', () => {
  // This is the line that was dead: messages.filter((m) => unprocessed.has(m.id)).
  const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const unprocessed = unseenIds(messages.map((m) => m.id), ['b']);
  const pending = messages.filter((m) => unprocessed.has(m.id));
  assert.deepEqual(pending.map((m) => m.id), ['a', 'c']);
  assert.equal(messages.length - pending.length, 1, 'skipped count stays right');
});

test('nothing seen yet means everything is pending', () => {
  const out = unseenIds(['a', 'b'], []);
  assert.deepEqual([...out].sort(), ['a', 'b']);
});

test('everything seen means nothing is pending — and never a re-import', () => {
  // The ledger is immutable: a thread handled once must never come back, even after
  // its proposal is dismissed.
  const out = unseenIds(['a', 'b'], ['a', 'b']);
  assert.equal(out.size, 0);
});

test('a Set is accepted for `seen` as readily as an array', () => {
  const out = unseenIds(['a', 'b'], new Set(['a']));
  assert.deepEqual([...out], ['b']);
});

test('an empty input yields an empty Set, not undefined or an array', () => {
  const out = unseenIds([], ['a']);
  assert.ok(out instanceof Set);
  assert.equal(out.size, 0);
});
