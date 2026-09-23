import React, { useState } from 'react';
import { Check, Loader2, Mail, Pencil, Sparkles, Undo2, X } from 'lucide-react';
import { EmailProposal } from '../types';
import { api } from '../services/apiService';

interface Props {
  proposal: EmailProposal;
  token: string;
  onSend: (id: number, draft: string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
}

/**
 * One-tap rewrites. These are the four things anyone actually asks for, and having them
 * as buttons means the common case costs no typing.
 */
const TONES: Array<{ label: string; instruction: string }> = [
  { label: 'Shorter', instruction: 'Make it shorter and more direct. Cut anything that is not load-bearing.' },
  { label: 'Warmer', instruction: 'Make it warmer and more personal, without becoming gushing or informal.' },
  { label: 'More formal', instruction: 'Make it more formal and precise, suitable for a client who does not know me well.' },
  { label: 'Firmer', instruction: 'Make it firmer and clearer about what I will and will not do. Stay polite, remove hedging.' },
];

/**
 * One thread the assistant thinks needs a reply, with the reply already written.
 *
 * The draft is editable in place and what is on screen is what gets sent — the edited
 * body is passed to the send call rather than the server re-reading a stored draft the
 * user has since changed.
 */
export const ProposalCard: React.FC<Props> = ({ proposal, token, onSend, onDismiss }) => {
  const original = proposal.draftReply || '';
  const [draft, setDraft] = useState(original);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'send' | 'dismiss' | null>(null);
  const [instructions, setInstructions] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  // Every version the AI replaced, so a rewrite is never a one-way door. Without this,
  // one click destroys text the user typed themselves and there is no way back.
  const [history, setHistory] = useState<string[]>([]);

  const act = async (kind: 'send' | 'dismiss') => {
    setBusy(kind);
    try {
      if (kind === 'send') await onSend(proposal.id, draft);
      else await onDismiss(proposal.id);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Hand the editor's text to the AI.
   *
   * If the user has changed the draft, what they wrote is treated as CONTENT — their
   * notes, their decisions — and the model only supplies the wording. If they have not
   * touched it, there is no new content and this is a polish of the existing draft.
   * That distinction is the difference between "write this properly" and "say something
   * else", and guessing it wrong would put words in their mouth.
   */
  const rewrite = async (instruction?: string) => {
    const edited = draft.trim() !== original.trim();
    const steer = instruction ?? instructions;
    if (!draft.trim() && !steer.trim()) {
      setRewriteError('Write a note first, or say how to change it.');
      return;
    }

    setRewriting(true);
    setRewriteError(null);
    try {
      const r = await api.proposals.rewrite(token, proposal.id, {
        notes: edited ? draft : '',
        currentDraft: draft,
        instructions: steer,
      });
      if (r?.ok === false || !r?.draft) {
        setRewriteError(r?.error || 'The AI could not rewrite that. Your text is unchanged.');
        return;
      }
      setHistory((h) => [...h, draft]);
      setDraft(r.draft);
      setInstructions('');
    } catch (e: any) {
      setRewriteError(e?.message || 'The rewrite failed. Your text is unchanged.');
    } finally {
      setRewriting(false);
    }
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setDraft(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  return (
    <div className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-700/60">
        <div className="flex items-start gap-3">
          <Mail className="w-4 h-4 text-primary mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white truncate">{proposal.subject || '(no subject)'}</h3>
            <p className="text-xs text-slate-500 truncate mt-0.5">{proposal.from}</p>
          </div>
        </div>
        {proposal.summary && <p className="text-sm text-slate-300 mt-3 leading-relaxed">{proposal.summary}</p>}
        {/* Why this surfaced — so a wrong call is arguable rather than mysterious. */}
        {proposal.reasoning && <p className="text-[11px] text-slate-500 mt-2 italic">{proposal.reasoning}</p>}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Suggested reply</span>
          <button
            onClick={() => setEditing((e) => !e)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Pencil className="w-3 h-3" /> {editing ? 'Done' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              placeholder="Write the reply, or just jot what you want to say — &quot;yes, 2 weeks, 40k, start Monday&quot; — then Rewrite."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 leading-relaxed"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => rewrite(t.instruction)}
                  disabled={rewriting}
                  className="text-[11px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
                >
                  {t.label}
                </button>
              ))}
              {history.length > 0 && (
                <button
                  onClick={undo}
                  disabled={rewriting}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors disabled:opacity-50 ml-auto"
                  title="Go back to the previous version"
                >
                  <Undo2 className="w-3 h-3" /> Undo
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !rewriting) rewrite(); }}
                placeholder="or tell the AI how to change it…"
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
              />
              <button
                onClick={() => rewrite()}
                disabled={rewriting}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
              >
                {rewriting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {rewriting ? 'Rewriting…' : 'Rewrite'}
              </button>
            </div>

            {rewriteError && (
              <p className="text-[11px] text-amber-400">{rewriteError}</p>
            )}
            <p className="text-[11px] text-slate-500">
              Rewrite keeps what you wrote and fixes only the wording — your decisions, dates and numbers are left alone.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-300 whitespace-pre-line bg-slate-800/50 rounded-lg p-3 leading-relaxed">
            {draft || <span className="text-slate-500 italic">No draft was written.</span>}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => act('send')}
            disabled={busy !== null || !draft.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Send reply
          </button>
          <button
            onClick={() => act('dismiss')}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-4 py-2.5 rounded-lg text-sm disabled:opacity-50"
          >
            {busy === 'dismiss' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
