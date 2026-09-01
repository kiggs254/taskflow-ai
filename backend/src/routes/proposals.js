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

router.post('/:id/dismiss', asyncHandler(async (req, res) => {
  const ok = await setProposalStatus(req.user.id, Number(req.params.id), 'dismissed');
  if (!ok) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ dismissed: true });
}));

export default router;
