import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { normalizePrivateKey } from '../src/services/githubAuth.js';

/**
 * A GitHub App private key is a multi-line PKCS#1 PEM, and env-var fields mangle it.
 * When the result isn't byte-exact, OpenSSL throws
 * `error:1E08010C:DECODER routines::unsupported` -- which reads like a GitHub or
 * network fault and sends you hunting in the wrong place. It is always local.
 *
 * The only meaningful assertion is "can OpenSSL actually sign a JWT with this",
 * so that's what these check.
 */

const { privateKey: PEM } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, // what GitHub hands you
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const signsOk = (key) => {
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update('jwt-payload');
    signer.sign(key, 'base64url');
    return true;
  } catch {
    return false;
  }
};

test('the generated PKCS#1 key is signable to begin with', () => {
  assert.equal(signsOk(PEM), true);
});

const manglings = {
  'pristine PEM': PEM,
  'backslash-n escaped (.env form)': PEM.replace(/\n/g, '\\n'),
  'base64 of the whole PEM': Buffer.from(PEM).toString('base64'),
  'newlines flattened to spaces': PEM.replace(/\n/g, ' '),
  'newlines stripped entirely': PEM.replace(/\n/g, ''),
  'missing trailing newline': PEM.trimEnd(),
  'surrounding whitespace': `\n  ${PEM}  \n`,
  'CRLF line endings': PEM.replace(/\n/g, '\r\n'),
};

for (const [name, mangled] of Object.entries(manglings)) {
  test(`normalizePrivateKey recovers: ${name}`, () => {
    assert.equal(signsOk(normalizePrivateKey(mangled)), true);
  });
}

test('reproduces the original bug: naive \\n-only handling fails on a flattened PEM', () => {
  // This was the shipped implementation, and this is the production error verbatim.
  const naive = (raw) => (raw || '').replace(/\\n/g, '\n');
  assert.equal(signsOk(naive(PEM.replace(/\n/g, ' '))), false);
});

test('does not manufacture a key from garbage', () => {
  assert.equal(signsOk(normalizePrivateKey('not-a-key')), false);
  assert.equal(normalizePrivateKey(''), '');
  assert.equal(normalizePrivateKey(undefined), '');
  assert.equal(normalizePrivateKey(null), '');
});
