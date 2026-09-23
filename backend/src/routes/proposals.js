import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  listProposals,
  getProposal,
  setProposalStatus,
  updateDraft,
  countPending,
} from '../services/proposalService.js';
import { sendThreadReply } from '../services/gmailService.js';
import { rewriteReply } from '../services/emailTriage.js';
import { query } from '../config/database.js';

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const status = ['pending', 'sent', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'pending';
  res.json({ proposals: await listProposals(req.user.id, status), pending: await countPending(req.user.id) });
}));

/** Edit the draft without sending — the "change it before you reply" path. */
router.put('/:id', asyncHandler(async (req, res) => {
  const draft = typeof req.body?.draftReply === 'string' ? req.body.draftReply : null;
  if (draft === null) return res.status(400).json({ error: 'draftReply is required' });
  const ok = await updateDraft(req.user.id, Number(req.params.id), draft);
  if (!ok) return res.status(404).json({ error: 'Proposal not found' });
  res.json(await getProposal(req.user.id, Number(req.params.id)));
}));

/**
 * Send the reply. The ONLY path that puts mail in front of anyone, and it exists solely
 * behind an explicit user action -- nothing in the scanner can reach it.
 */
router.post('/:id/send', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const proposal = await getProposal(req.user.id, id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status === 'sent') return res.status(409).json({ error: 'Already sent' });

  // Prefer the body in this request, so an edit made in the UI is what actually goes out
  // rather than the stored draft it was based on.
  const body = typeof req.body?.draftReply === 'string' && req.body.draftReply.trim()
    ? req.body.draftReply
    : proposal.draftReply;
  if (!body?.trim()) return res.status(400).json({ error: 'Nothing to send' });

  const meta = proposal.threadMetadata || {};
  await sendThreadReply(req.user.id, {
    threadId: proposal.threadId,
    messageId: meta.messageId || proposal.lastMessageId,
    subject: proposal.subject,
    message: body,
  });

  await updateDraft(req.user.id, id, body);
  await setProposalStatus(req.user.id, id, 'sent');
  res.json({ sent: true, id });
}));

/**
 * POST /api/proposals/:id/rewrite
 * Body: { notes?, instructions?, currentDraft? } -> { draft }
 *
 * Turn the user's own rough notes into the reply, with the thread as context. Writes
 * nothing: the result goes back to the editor for them to accept, edit again, or throw
 * away. Persisting it would overwrite a draft they may prefer, and there is no undo on
 * a server-side overwrite.
 *
 * Thread context comes from the stored proposal rather than the request body -- it is
 * what makes the reply answer the actual question instead of being generically polite.
 */
router.post('/:id/rewrite', asyncHandler(async (req, res) => {
  const proposal = await getProposal(req.user.id, Number(req.params.id));
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
  const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : '';
  // The editor's live text when it sent one, including a deliberately emptied editor --
  // `??` rather than a truthiness check, so an empty string is respected as "the editor
  // is empty" instead of silently resurrecting the stored draft the user just cleared.
  const sent = typeof req.body?.currentDraft === 'string' ? req.body.currentDraft : null;
  const currentDraft = sent !== null ? sent : proposal.draftReply || '';

  // Instructions alone are NOT enough. A tone chip always supplies one, so including it
  // in this guard let an empty editor through: the model then had only the subject and a
  // one-line summary, and the schema demands a complete reply, so it invented a whole
  // message to a client -- which then enabled Send.
  if (!notes.trim() && !currentDraft.trim()) {
    return res.status(400).json({
      error: 'Nothing to rewrite — write a note or some text first. A tone on its own has nothing to work from.',
    });
  }

  const userResult = await query('SELECT username FROM users WHERE id = $1', [req.user.id]);

  const draft = await rewriteReply(req.user.id, {
    subject: proposal.subject,
    from: proposal.from,
    summary: proposal.summary,
    currentDraft,
    notes,
    instructions,
    userName: userResult.rows[0]?.username || '',
  });

  // 200 with ok:false, not a 500: the user's own text is still in the editor and has not
  // been touched, so this is a declined request rather than a broken one.
  if (!draft) {
    return res.json({ ok: false, error: 'The AI could not rewrite that. Your text is unchanged.' });
  }

  res.json({ ok: true, draft });
}));

router.post('/:id/dismiss', asyncHandler(async (req, res) => {
  const ok = await setProposalStatus(req.user.id, Number(req.params.id), 'dismissed');
  if (!ok) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ dismissed: true });
}));

export default router;
