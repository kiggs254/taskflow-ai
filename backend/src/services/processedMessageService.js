import { query } from '../config/database.js';

/**
 * Immutable "already seen" ledger for Gmail messages.
 *
 * The rule that makes this work: a ledger entry records that a message was
 * *processed*, not that a task currently *exists*. It is never deleted in response
 * to the user rejecting a draft or deleting a task -- those are exactly the actions
 * that used to make an email eligible for re-import.
 *
 * Mirrors the processed_slack_messages pattern that Slack has had all along.
 */

/**
 * Message ids from `messageIds` that have already been processed for this user.
 * Batched into one query so a 50-message scan costs one round trip, not 50.
 */
export const filterUnprocessedGmailIds = async (userId, messageIds) => {
  if (!messageIds.length) return [];

  const result = await query(
    `SELECT message_id FROM processed_gmail_messages
     WHERE user_id = $1 AND message_id = ANY($2::varchar[])`,
    [userId, messageIds]
  );

  const seen = new Set(result.rows.map(r => r.message_id));
  return messageIds.filter(id => !seen.has(id));
};

export const isGmailMessageProcessed = async (userId, messageId) => {
  const result = await query(
    'SELECT 1 FROM processed_gmail_messages WHERE user_id = $1 AND message_id = $2 LIMIT 1',
    [userId, messageId]
  );
  return result.rows.length > 0;
};

/**
 * Record that a message was handled. Idempotent.
 *
 * `outcome` is informational ('task' | 'draft' | 'irrelevant'); the mere presence of
 * the row is what suppresses reprocessing. Recording 'irrelevant' matters as much as
 * the others -- an email the AI judged uninteresting should not be re-judged (and
 * re-billed) on every scan.
 */
export const markGmailMessageProcessed = async (userId, messageId, { taskId = null, outcome = null } = {}) => {
  await query(
    `INSERT INTO processed_gmail_messages (user_id, message_id, task_id, outcome)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [userId, messageId, taskId, outcome]
  );
};
