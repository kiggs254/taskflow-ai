import test from 'node:test';
import assert from 'node:assert/strict';
import { sitesInPrompts } from '../src/services/agentService.js';

/**
 * The site is the one fact that makes a session entry legible to someone running
 * twenty client systems, and it was being dropped. Both sessions that prompted this
 * named their site in a prompt and neither summary mentioned it.
 *
 * Extracted deterministically rather than left to the summariser: the URL is typically
 * buried inside a 500-char prompt (the recorder truncates each one) next to a paste of
 * PHP. These are the real prompts, verbatim.
 */

test('finds the site in a URL buried at the end of a long prompt', () => {
  const prompts = [
    "i need a woocommerce plugin to add a whastapp button the products pages by modifying " +
      "this that ads it on the card for out of stock and zero priced....make add a button now " +
      "on normal products pdp only /** WhatsApp Enquiry Mode */ function nk_get_restricted_terms() " +
      "{ return array( 'CST', 'LIGHT TRUCK' ); }",
    'Not so big.. same size as Add to cart and next to it using flatsome ' +
      'https://silverstone.co.ke/product/general-285-75r16-grabber-a-tx-lt-126-123r/',
  ];
  assert.deepEqual(sitesInPrompts(prompts), ['silverstone.co.ke']);
});

test('finds the site named in the opening sentence', () => {
  const prompts = [
    'got website called https://perfumeuae.com/ running woocommerce... i need to enable ' +
      'fuzzy matching searches.... they sell perfumes and most people mistype',
    'is this true? Dictionary: 8,240 terms from 13,840 products, built 1 second ago.',
  ];
  assert.deepEqual(sitesInPrompts(prompts), ['perfumeuae.com']);
});

test('a bare domain counts, because that is how people write', () => {
  assert.deepEqual(sitesInPrompts(['can you check perfumeuae.com for me']), ['perfumeuae.com']);
});

test('filenames and version numbers are not sites', () => {
  // The failure that matters: a heading reading "wp-config.php" instead of the client.
  assert.deepEqual(
    sitesInPrompts(['edit wp-config.php and index.js, bump to v2.3.1, see README.md and styles.scss']),
    []
  );
});

test('the same site written differently is one site', () => {
  assert.deepEqual(
    sitesInPrompts(['https://Silverstone.co.ke/shop', 'also www.silverstone.co.ke', 'and SILVERSTONE.CO.KE']),
    ['silverstone.co.ke']
  );
});

test('order of first mention is kept, so the primary site leads', () => {
  assert.deepEqual(
    sitesInPrompts(['compare perfumeuae.com against silverstone.co.ke', 'more on silverstone.co.ke']),
    ['perfumeuae.com', 'silverstone.co.ke']
  );
});

test('a wall of links cannot flood the prompt', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://site${i}.com/page`).join(' ');
  assert.equal(sitesInPrompts([many]).length, 5, 'capped');
});

test('no site means no site — never a placeholder', () => {
  assert.deepEqual(sitesInPrompts(['refactor the invoice generator and add tests']), []);
  assert.deepEqual(sitesInPrompts([]), []);
  assert.deepEqual(sitesInPrompts([null, undefined, '']), []);
});

test('subdomains are kept distinct from the apex', () => {
  assert.deepEqual(
    sitesInPrompts(['staging.perfumeuae.com is broken but perfumeuae.com is fine']),
    ['staging.perfumeuae.com', 'perfumeuae.com']
  );
});

/**
 * composeProjectLabel — the invention guard on the standup heading.
 *
 * The heading is the most load-bearing string in the report: it tells a manager whose
 * system was worked on. The model is asked for the site, but asked is not verified, so
 * a hostname it was never given is stripped rather than trusted. A wrong client name in
 * a report checked against real records is worse than no client name.
 */

test('a grounded site is kept and the heading names it', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  assert.equal(
    composeProjectLabel('WhatsApp enquiry plugin for silverstone.co.ke', 'silverstone.co.ke', ['silverstone.co.ke']),
    'WhatsApp enquiry plugin for silverstone.co.ke'
  );
});

test('the site is appended when the model left it out of the heading', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  assert.equal(
    composeProjectLabel('Fuzzy search configuration', 'perfumeuae.com', ['perfumeuae.com']),
    'Fuzzy search configuration for perfumeuae.com'
  );
});

test('a site that was never in the requests is refused', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  // The model naming a plausible-but-unmentioned client is the failure that matters.
  assert.equal(
    composeProjectLabel('Stock sync script', 'acme-corp.com', ['perfumeuae.com']),
    'Stock sync script',
    'an ungrounded site must not reach the heading'
  );
});

test('a hallucinated hostname written into the heading text is stripped out', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  // The model writes `project` freely, so validating only the `site` field is not enough.
  assert.equal(
    composeProjectLabel('Checkout fix for notmysite.example', '', ['perfumeuae.com']),
    'Checkout fix'
  );
});

test('no site anywhere gives the deliverable alone, never a placeholder', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  assert.equal(composeProjectLabel('WooCommerce webhook auto-reenabler', '', []), 'WooCommerce webhook auto-reenabler');
  assert.equal(composeProjectLabel('', '', [], 'Random AI tasks'), 'Random AI tasks', 'falls back to the folder label');
});

test('the heading can never contain the title separator', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  // splitProjectTitle cuts the stored title on the FIRST " — ", so a heading carrying
  // one would swallow the summary and leave the narrative blank.
  const out = composeProjectLabel('Plugin — for the shop', 'perfumeuae.com', ['perfumeuae.com']);
  assert.ok(!out.includes(' — '), out);
  assert.match(out, /perfumeuae\.com$/);
});

test('case and www. differences still match the grounded list', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  assert.match(
    composeProjectLabel('Search config', 'WWW.PerfumeUAE.com', ['perfumeuae.com']),
    /for perfumeuae\.com$/
  );
});

test('a long handle is truncated but the client name survives', async () => {
  const { composeProjectLabel } = await import('../src/services/agentService.js');
  const out = composeProjectLabel(
    'Extremely long winded description of a WooCommerce plugin that does many things indeed',
    'silverstone.co.ke',
    ['silverstone.co.ke']
  );
  assert.ok(out.endsWith('for silverstone.co.ke'), `client name must survive truncation: ${out}`);
});

/**
 * A denylist of file extensions is unbounded, so the TLD is allowlisted too.
 *
 * "blh3jaemh.output" — a scratch file — was published as a client's website in a real
 * report heading. The next one would have been .bak, .orig or .patch. Two-letter TLDs
 * pass generically (every ccTLD), recognised gTLDs pass by name, and anything else is
 * not a site. That fails in the safe direction: a missing client name, never a wrong one.
 */
test('a scratch filename is not a client website', () => {
  assert.deepEqual(
    sitesInPrompts(['see /tmp/scratch/blh3jaemh.output for the task result']),
    [],
    'the exact string that shipped as a client name'
  );
});

test('other invented extensions are rejected too, without being listed', () => {
  for (const name of ['config.bak', 'patch.orig', 'dump.sqlite3', 'notes.markdown', 'thing.backup']) {
    assert.deepEqual(sitesInPrompts([`open ${name}`]), [], name);
  }
});

test('two-letter extensions are still rejected despite looking like ccTLDs', () => {
  // .js and .go are two letters, so the ccTLD rule would wave them through if the
  // extension denylist did not run first.
  assert.deepEqual(sitesInPrompts(['edit index.js and main.go and run build.sh']), []);
});

test('real client domains still come through', () => {
  assert.deepEqual(
    sitesInPrompts(['perfumeuae.com, silverstone.co.ke, cargen.com and e-biz.co.ke']),
    ['perfumeuae.com', 'silverstone.co.ke', 'cargen.com', 'e-biz.co.ke']
  );
});

test('modern gTLDs a client might actually use are kept', () => {
  assert.deepEqual(
    sitesInPrompts(['hosted at shopflow.app and the docs at taskflow.dev']),
    ['shopflow.app', 'taskflow.dev']
  );
});

test('scrubbing is lenient where extraction is strict', () => {
  // Extraction must not promote a scratch file to a client name...
  assert.deepEqual(sitesInPrompts(['see blh3jaemh.output']), []);
  // ...but the heading scrubber must catch anything host-shaped, because a false
  // positive only removes an odd-looking token while a false negative publishes a
  // client name the model invented.
  assert.deepEqual(sitesInPrompts(['Checkout fix for notmysite.example'], { strict: false }), ['notmysite.example']);
});
