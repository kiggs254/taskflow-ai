import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The redactor in agent-hooks/taskflow-record.mjs.
 *
 * It is the only thing between "record what was built" and "post an API key to a web
 * service". It runs before a command is written to the local session log, so a secret
 * is never persisted either.
 *
 * Loaded by extracting the function from the hook source rather than importing it: the
 * hook is a standalone executable that reads stdin and writes files on import, and it
 * ships as a copy the user installs into ~/.claude/hooks. Testing the shipped text is
 * the point — a divergent copy is exactly the bug that would matter.
 */
const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'agent-hooks', 'taskflow-record.mjs'
);
const src = fs.readFileSync(HOOK, 'utf8');
const start = src.indexOf('const redact = (command) => {');
const end = src.indexOf('\n};', src.indexOf('return out;', start)) + 3;
assert.ok(start > 0 && end > start, 'redact() not found in the hook source');
const { redact } = await import(
  `data:text/javascript,${encodeURIComponent('export ' + src.slice(start, end))}`
);

/** A secret must not survive, wherever it sits in the command. */
const hidden = (secret, command) => {
  const out = redact(command);
  assert.ok(!out.includes(secret), `LEAKED\n  in:  ${command}\n  out: ${out}`);
};

test('credentials are stripped from every shape we know', () => {
  hidden('tf_0499344b9674506cabab273d02c1e45adc542ec13074b696',
    'curl -H "Authorization: Bearer tf_0499344b9674506cabab273d02c1e45adc542ec13074b696" https://api/x');
  hidden('cfat_un21pX8uiMj1lqrEXFZzH8k9u2hHvJUWcMd8',
    'export CLOUDFLARE_API_TOKEN=cfat_un21pX8uiMj1lqrEXFZzH8k9u2hHvJUWcMd8');
  hidden('sk-proj-abc123def456ghi789jkl012',
    'OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012 node script.js');
  hidden('ghp_16CharsAtLeastHereOk123456',
    'git remote set-url origin https://ghp_16CharsAtLeastHereOk123456@github.com/x/y.git');
  hidden('AKIAIOSFODNN7EXAMPLE', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE');
  hidden('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
  hidden('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
    'curl -H "X-Auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u" api');
  hidden('MIIEowIBAAKCAQEAxyzabc',
    'echo "-----BEGIN RSA PRIVATE KEY-----MIIEowIBAAKCAQEAxyzabc-----END RSA PRIVATE KEY-----" > k.pem');
  hidden('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    'wp option update some_api_key a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
});

test('passwords survive neither = nor a space nor an attached short flag', () => {
  hidden('hunter2supersecret', 'mysql -u root --password=hunter2supersecret wordpress');
  // --dbpass, not --pass: tools prefix the keyword freely, and matching the bare word
  // kept this password in full.
  hidden('hunter2supersecret', 'wp db query --dbpass hunter2supersecret');
  hidden('hunter2supersecret', 'mysql -u root -phunter2supersecret db');
  hidden('p4ssw0rd-in-url', 'psql postgres://admin:p4ssw0rd-in-url@db.example.com:5432/app');
});

test('an assignment inside a quoted remote command is still stripped', () => {
  // Anchoring on whitespace alone let this through: the quote is what precedes it.
  hidden('s3cr3t-value-here', "ssh deploy@host 'SECRET_KEY=s3cr3t-value-here ./run.sh'");
});

test('writing to an env file never keeps the value', () => {
  const out = redact('echo "DB_PASSWORD=letmein123" >> .env');
  assert.ok(!out.includes('letmein123'));
  assert.match(out, /redacted/);
});

test('the commands that explain the work survive legibly', () => {
  // Over-redaction is cheap (a vaguer summary); under-redaction is a leaked key. But
  // redacting everything would defeat the feature, so these must come through.
  const keeps = [
    ['whatsapp-button.php', 'cat > wp-content/plugins/whatsapp-button/whatsapp-button.php <<EOF'],
    ['wp plugin activate', 'wp plugin activate whatsapp-enquiry --path=/var/www/silverstone'],
    ['silverstone.co.ke', 'curl -I https://silverstone.co.ke/product/general-285-75r16/'],
    ['npm run build', 'npm run build && rsync -az dist/ web@host:/var/www/'],
    ['better-search', 'wp plugin install better-search --activate'],
    ['git commit', 'git commit -m "feat(search): add fuzzy matching dictionary"'],
    ['--path=/var/www', 'wp search-replace old.com new.com --path=/var/www'],
  ];
  for (const [fragment, command] of keeps) {
    assert.ok(redact(command).includes(fragment), `OVER-REDACTED: ${command} -> ${redact(command)}`);
  }
});
