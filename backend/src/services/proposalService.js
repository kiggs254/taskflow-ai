import { query } from '../config/database.js';

/**
 * Email proposals: what the assistant thinks you should reply, waiting for your say-so.
 *
 * One row per thread. Nothing here is ever sent automatically -- `status` only leaves
 * 'pending' because a human pressed something.
 */

const SELECT = `
  SELECT id, thread_id AS "threadId", last_message_id AS "lastMessageId", subject,
         from_address AS "from", classification, summary, reasoning,
         draft_reply AS "draftReply", status, thread_metadata AS "threadMetadata",
         created_at AS "createdAt", updated_at AS "updatedAt"
    FROM email_proposals`;

export const listProposals = async (userId, status = 'pending') => {
  const r = await query(
    `${SELECT} WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 100`,
    [userId, status]
  );
  return r.rows;
};

export const getProposal = async (userId, id) => {
  const r = await query(`${SELECT} WHERE user_id = $1 AND id = $2`, [userId, id]);
  return r.rows[0] ?? null;
};

/**
 * Upsert one thread's proposal.
 *
 * A thread that gets a new message reopens its proposal: the earlier draft was written
 * against a conversation that has since moved, so leaving it 'dismissed' would hide a
 * reply the user has not actually seen. Only `sent` is left alone -- that one is done.
 */
export const upsertProposal = async (userId, p) => {
  const r = await query(
    `INSERT INTO email_proposals (
       user_id, thread_id, last_message_id, subject, from_address,
       classification, summary, reasoning, draft_reply, thread_metadata, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
     ON CONFLICT (user_id, thread_id) DO UPDATE SET
       last_message_id = EXCLUDED.last_message_id,
       subject         = EXCLUDED.subject,
       from_address    = EXCLUDED.from_address,
       classification  = EXCLUDED.classification,
       summary         = EXCLUDED.summary,
       reasoning       = EXCLUDED.reasoning,
       draft_reply     = EXCLUDED.draft_reply,
       thread_metadata = EXCLUDED.thread_metadata,
       status          = CASE WHEN email_proposals.status = 'sent'
                              THEN email_proposals.status ELSE 'pending' END,
       updated_at      = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      userId, p.threadId, p.lastMessageId ?? null, p.subject ?? null, p.from ?? null,
      p.classification ?? null, p.summary ?? null, p.reasoning ?? null,
      p.draftReply ?? null, JSON.stringify(p.threadMetadata ?? {}),
    ]
  );
  return r.rows[0]?.id ?? null;
};

export const setProposalStatus = async (userId, id, status) => {
  const r = await query(
    `UPDATE email_proposals SET status = $3, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id, status]
  );
  return r.rows.length > 0;
};

export const updateDraft = async (userId, id, draftReply) => {
  const r = await query(
    `UPDATE email_proposals SET draft_reply = $3, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id, draftReply]
  );
  return r.rows.length > 0;
};

export const countPending = async (userId) => {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM email_proposals WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return r.rows[0]?.n ?? 0;
};
