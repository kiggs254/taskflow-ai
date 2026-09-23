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

const REWRITE_SCHEMA = {
  name: 'email_reply',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply'],
    properties: {
      reply: {
        type: 'string',
        description:
          'The complete reply body, ready to send: greeting, body, sign-off. Plain text ' +
          'with blank lines between paragraphs. No subject line, no "Re:", no quoted ' +
          'history, no markdown, no placeholders like [your name] or [date].',
      },
    },
  },
};

/**
 * Rewrite a reply from the user's own rough notes.
 *
 * Distinct from triage's draft, which answers a thread the user has not read yet. This
 * one exists for when they HAVE read it and disagree with the draft: they type what they
 * actually want to say -- often three words and a decision -- and this turns it into the
 * mail. Their notes are the content; the model supplies only the wording.
 *
 * The thread is passed in because a reply written blind is generically polite and
 * answers nothing. It is the difference between "Thanks for reaching out, we'll be in
 * touch" and an actual answer to what was asked.
 *
 * Returns null on failure rather than a fallback string: the caller still has the user's
 * own text, and quietly handing it back unchanged would look like a rewrite that decided
 * nothing needed changing.
 */
export const rewriteReply = async (
  userId,
  { subject, from, summary, currentDraft, notes, instructions, userName }
) => {
  const hasNotes = Boolean(notes && notes.trim());
  const hasDraft = Boolean(currentDraft && currentDraft.trim());

  // A tone ("Firmer") or an instruction is a directive about WORDING. With neither notes
  // nor a draft there is nothing to reword -- and because the schema requires a complete
  // reply body, the model would invent an entire message to a client out of a one-line
  // summary, then drop it into the editor under copy promising it kept what the user
  // wrote. Refusing is the only honest answer. The callers guard this too; this is the
  // backstop that makes the state unreachable rather than merely unlikely.
  if (!hasNotes && !hasDraft) {
    console.warn('Reply rewrite refused: no notes and no draft to work from.');
    return null;
  }

  // When the user has replaced the draft, their text arrives as the notes and the thing
  // they rejected is the stored draft -- never the same string. Showing their own words
  // back to the model labelled "the user was not happy with this", directly above
  // "follow these exactly", is standing licence to change the content rather than the
  // wording: the one failure this whole feature is built to prevent.
  const rejectedDraft =
    hasDraft && (!hasNotes || currentDraft.trim() !== notes.trim()) ? currentDraft.trim() : '';

  try {
    const { content } = await callAI({
      taskKind: 'email_reply_rewrite',
      // Interactive: someone is watching a spinner, so latency matters more than the
      // last few points of quality.
      tier: 'fast',
      userId,
      temperature: 0.4,
      maxTokens: 900,
      schema: REWRITE_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You write the body of a business email reply on behalf of a freelance ' +
            'developer, in their voice: direct, warm, unfussy, no corporate padding.\n\n' +
            'THE NOTES ARE THE CONTENT. When the user gives you rough notes, they have ' +
            'already decided what to say — your job is wording, not opinion. Keep every ' +
            'commitment, refusal, date, price and caveat exactly as given. Never soften a ' +
            '"no" into a "maybe", never add a promise they did not make, and never invent ' +
            'a date, a number or a next step they did not mention.\n\n' +
            'If something they need is genuinely missing, ask for it in one short ' +
            'sentence rather than inventing it.\n\n' +
            'No markdown. No subject line. No quoted history. No square-bracket ' +
            'placeholders — if you cannot name something, write around it. End with a ' +
            'plain sign-off using the sender name given, or no name at all if none was. ' +
            'Return json.',
        },
        {
          role: 'user',
          content:
            `The email being replied to:\nSubject: ${subject || '(none)'}\n` +
            `From: ${from || '(unknown)'}\n` +
            `What it is about: ${summary || '(not summarised)'}\n\n` +
            (rejectedDraft
              ? `The current draft (the user was not happy with this):\n${rejectedDraft}\n\n`
              : '') +
            (hasNotes
              ? `What the user actually wants to say — these are their instructions for ` +
                `content, follow them exactly:\n${notes.trim()}\n\n`
              : `The user gave no new content. Rewrite the draft above to read better ` +
                `without changing what it commits to. Do not add anything it does not ` +
                `already say.\n\n`) +
            (instructions?.trim() ? `How they want it written: ${instructions.trim()}\n\n` : '') +
            `Sign off as: ${userName || '(no name given — omit the name)'}`,
        },
      ],
    });

    const reply = JSON.parse(content)?.reply;
    return typeof reply === 'string' && reply.trim() ? reply.trim() : null;
  } catch (error) {
    console.error('Reply rewrite failed:', error.message);
    return null;
  }
};
