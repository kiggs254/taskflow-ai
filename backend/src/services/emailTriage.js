import { callAI } from './ai/callAI.js';
import { truncateAtWord } from '../utils/text.js';

/**
 * Decide what, if anything, a mail thread needs from a human — and draft it.
 *
 * The pipeline this replaces had no way to say "no reply needed": parseEmailThread always
 * returned a title, and the only filter was written to "DEFAULT TO APPROVING". So every
 * receipt and cron alert became a task. Here `needsReply: false` is a first-class answer,
 * required by the schema, and it is the answer the prompt pushes toward for machine mail.
 */

const TRIAGE_SCHEMA = {
  name: 'email_triage',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['needsReply', 'classification', 'summary', 'reasoning'],
    properties: {
      needsReply: {
        type: 'boolean',
        description:
          'True ONLY if a human must personally write back. False for receipts, ' +
          'invoices, automated alerts, newsletters, notifications, and threads where ' +
          'the last message is already a satisfactory answer or is from the user.',
      },
      classification: {
        type: 'string',
        enum: [
          'needs_reply',
          'automated_notification',
          'receipt_or_invoice',
          'newsletter_or_marketing',
          'already_handled',
          'informational',
        ],
        description: 'Why it was or was not surfaced.',
      },
      summary: {
        type: 'string',
        description:
          'One or two plain sentences: what this thread is about and what is being ' +
          'asked. No greeting, no filler.',
      },
      reasoning: {
        type: 'string',
        description:
          'One short sentence justifying the needsReply decision, so a wrong call can ' +
          'be reviewed later.',
      },
      draftReply: {
        type: 'string',
        description:
          'Only when needsReply is true: a complete reply ready to send, in the ' +
          "user's voice — direct, warm, no corporate padding. Omit entirely otherwise.",
      },
      meetingTime: {
        type: 'string',
        description:
          'Only if the thread proposes or confirms a specific meeting date and time. ' +
          'ISO 8601. Omit if there is no explicit meeting time. Never guess.',
      },
    },
  },
};

const SYSTEM = [
  'You triage one email thread for a busy solo developer who builds and runs ecommerce',
  'systems for clients. You decide whether it needs a personal reply, and if so you write',
  'that reply.',
  '',
  'Set needsReply FALSE for: payment receipts and invoices, automated error or monitoring',
  'alerts, deployment and cron notifications, newsletters, marketing, delivery and social',
  'notifications, calendar acknowledgements, and any thread whose last message is from the',
  'user or already resolves the question. These are the majority of mail. Saying "no reply',
  'needed" is a correct and expected answer, not a failure.',
  '',
  'Set needsReply TRUE when a person is waiting on this developer: a client question, a',
  'request for work, a quote, a decision, an approval, a scheduling ask, or a complaint.',
  '',
  'When drafting, answer the ACTUAL question in the latest message using the whole thread',
  'for context. Be specific and brief. Do not invent commitments, prices, or dates that',
  'are not already in the thread — if something must be confirmed, say so plainly rather',
  'than inventing it. No "I hope this email finds you well".',
  '',
  'Only set meetingTime if the thread states an explicit date and time. Never infer one',
  'from when the mail was sent. Return json.',
].join('\n');

/**
 * @returns {{needsReply, classification, summary, reasoning, draftReply, meetingTime}}
 *   or null when the model could not be reached. Null means "unknown" -- the caller must
 *   not treat it as "no reply needed", or an outage would silently swallow real mail.
 */
export const triageThread = async (userId, { subject, from, participants, threadText, instructions }) => {
  try {
    const { content } = await callAI({
      taskKind: 'email_triage',
      tier: 'smart',
      userId,
      temperature: 0.2,
      maxTokens: 1200,
      schema: TRIAGE_SCHEMA,
      messages: [
        {
          role: 'system',
          content: instructions?.trim()
            ? `${SYSTEM}\n\nThe user adds these standing instructions, which override the above where they conflict:\n${instructions.trim()}`
            : SYSTEM,
        },
        {
          role: 'user',
          content:
            `Subject: ${subject || '(none)'}\n` +
            `From: ${from || '(unknown)'}\n` +
            `Participants: ${(participants || []).slice(0, 20).join(', ') || '(unknown)'}\n\n` +
            `Thread (oldest first):\n${String(threadText || '').slice(0, 24000)}`,
        },
      ],
    });

    const parsed = JSON.parse(content);
    if (typeof parsed?.needsReply !== 'boolean') {
      // Succeeded but wrong shape. Returning null rather than guessing: a coerced
      // `false` here would silently drop a real client email.
      console.error(
        'Email triage: model returned no boolean `needsReply`; treating as unknown. ' +
          `Keys: [${Object.keys(parsed ?? {}).join(', ') || 'none'}]`
      );
      return null;
    }

    return {
      needsReply: parsed.needsReply,
      classification: parsed.classification || (parsed.needsReply ? 'needs_reply' : 'informational'),
      summary: truncateAtWord(parsed.summary || '', 600),
      reasoning: truncateAtWord(parsed.reasoning || '', 300),
      draftReply: parsed.needsReply ? String(parsed.draftReply || '').trim() : null,
      meetingTime: parsed.meetingTime || null,
    };
  } catch (error) {
    console.error('Email triage failed:', error.message);
    return null;
  }
};
