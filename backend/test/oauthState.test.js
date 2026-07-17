import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.API_SECRET = process.env.API_SECRET || 'test-secret-key';
const { signState, verifyState } = await import('../src/utils/oauthState.js');

test('round-trips the user id', () => {
  assert.equal(verifyState(signState(42, 'github'), 'github'), 42);
});

test('rejects a bare user id (the attack this exists to stop)', () => {
  // The old scheme was `state = userId.toString()`, parsed with parseInt. An
  // attacker could complete their own OAuth flow against a victim's account by
  // editing one query param.
  assert.throws(() => verifyState('7', 'github'));
  assert.throws(() => verifyState(Buffer.from('7').toString('base64url') + '.x', 'github'));
});

test('rejects tampering', () => {
  const state = signState(42, 'github');
  const [payload, sig] = state.split('.');

  const forged = Buffer.from(
    JSON.stringify({ uid: 99, provider: 'github', nonce: 'x', exp: Date.now() + 60_000 })
  ).toString('base64url');

  assert.throws(() => verifyState(`${forged}.${sig}`, 'github'), /signature/);
  assert.throws(() => verifyState(`${payload}.${sig.slice(0, 10)}`, 'github'), /signature/);
  assert.throws(() => verifyState(`${payload}.`, 'github'));
  assert.throws(() => verifyState(payload, 'github'), /format/);
  assert.throws(() => verifyState('....', 'github'));
});

test('a signature from the wrong secret cannot forge a state', () => {
  const [payload] = signState(42, 'github').split('.');
  const bad = crypto.createHmac('sha256', 'WRONG').update(payload).digest().toString('base64url');
  assert.throws(() => verifyState(`${payload}.${bad}`, 'github'), /signature/);
});

test('state minted for one provider cannot be replayed at another callback', () => {
  assert.throws(() => verifyState(signState(42, 'gmail'), 'github'), /provider mismatch/);
});

test('expired state is rejected', () => {
  const payload = Buffer.from(
    JSON.stringify({ uid: 42, provider: 'github', nonce: 'n', exp: Date.now() - 1 })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.API_SECRET)
    .update(payload)
    .digest()
    .toString('base64url');
  assert.throws(() => verifyState(`${payload}.${sig}`, 'github'), /expired/);
});

test('the nonce makes every state unique', () => {
  assert.notEqual(signState(42, 'github'), signState(42, 'github'));
});

test('rejects invalid user ids at mint time', () => {
  assert.throws(() => signState(0, 'github'));
  assert.throws(() => signState('42', 'github'));
  assert.throws(() => signState(42, ''));
});
