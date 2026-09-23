import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteReply } from '../src/services/emailTriage.js';

/**
 * The reply rewriter's refusal, which is the safety boundary of the feature.
 *
 * Rewriting is allowed to change WORDING. It is never allowed to originate CONTENT: the
 * result lands in a send-ready editor under copy telling the user it kept what they
 * wrote, and a fabricated commitment goes to a client under their name.
 *
 * These run without the network or a database because the refusal happens before any AI
 * call. A case that gets past the guard would try to reach a provider and fail loudly
 * here, which is itself the signal.
 */

const thread = {
  subject: 'Request: move blog authoring into the Staff Portal',
  from: 'Bidan Mashauri <bidan@hotpoint.co.ke>',
  summary: 'Bidan asks to move blog authoring from the admin backend into the Staff Portal.',
  userName: 'Newton',
};

test('a tone with an empty editor is refused, not answered', async () => {
  // The defect: the guard was "no draft AND no instruction", but a tone chip always
  // supplies an instruction. An empty editor therefore reached the model, which -- with a
  // schema demanding a complete reply body -- invented an entire message to a client from
  // the one-line summary, and Send went from disabled to enabled.
  const out = await rewriteReply(1, {
    ...thread,
    currentDraft: '',
    notes: '',
    instructions: 'Make it firmer and clearer about what I will and will not do.',
  });
  assert.equal(out, null, 'a tone is a wording directive; it is not authority to write a reply');
});

test('whitespace is not content', async () => {
  const out = await rewriteReply(1, {
    ...thread,
    currentDraft: '   \n\n  ',
    notes: '',
    instructions: 'Shorter',
  });
  assert.equal(out, null);
});

test('no notes, no draft and no instruction is refused', async () => {
  const out = await rewriteReply(1, { ...thread, currentDraft: '', notes: '', instructions: '' });
  assert.equal(out, null);
});

/**
 * The second defect was in the prompt rather than the guard: the editor sent its text as
 * BOTH `notes` and `currentDraft`, so the model was shown one string labelled "the user
 * was not happy with this" immediately above the same string labelled "follow these
 * exactly". That is standing licence to change the content -- the precise failure the
 * feature exists to prevent, and the one that softens a client-facing "no".
 *
 * The prompt is assembled inside a closure, so it is asserted through the export that
 * builds it: the helper below mirrors the module's own expression, and the test fails if
 * the module's copy ever diverges from it.
 */
const rejectedDraftFor = (currentDraft, notes) => {
  const hasNotes = Boolean(notes && notes.trim());
  const hasDraft = Boolean(currentDraft && currentDraft.trim());
  return hasDraft && (!hasNotes || currentDraft.trim() !== notes.trim()) ? currentDraft.trim() : '';
};

test('the user\'s own notes are never shown back as the draft they rejected', () => {
  const notes = "no, we can't do 40k, 55k or nothing";
  assert.equal(
    rejectedDraftFor(notes, notes),
    '',
    'identical text must not appear as both the rejected draft and the content to follow'
  );
});

test('a genuinely different draft IS shown as the rejected one', () => {
  assert.equal(
    rejectedDraftFor('Thanks for reaching out, we will be in touch.', 'no, 55k or nothing'),
    'Thanks for reaching out, we will be in touch.',
    'the model should see what was rejected when it differs from the notes'
  );
});

test('with no notes the draft is the thing being polished', () => {
  assert.equal(rejectedDraftFor('Hi Bidan, thanks for the note.', ''), 'Hi Bidan, thanks for the note.');
});

test('the module agrees with this expression', async () => {
  // Guards against the module drifting from the mirror above.
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/services/emailTriage.js', import.meta.url), 'utf8')
  );
  assert.match(
    src,
    /hasDraft && \(!hasNotes \|\| currentDraft\.trim\(\) !== notes\.trim\(\)\)/,
    'rejectedDraft is no longer computed the way this test asserts'
  );
});
