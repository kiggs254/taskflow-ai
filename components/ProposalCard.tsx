import React, { useState } from 'react';
import { Check, Loader2, Mail, Pencil, X } from 'lucide-react';
import { EmailProposal } from '../types';

interface Props {
  proposal: EmailProposal;
  onSend: (id: number, draft: string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
}

/**
 * One thread the assistant thinks needs a reply, with the reply already written.
 *
 * The draft is editable in place and what is on screen is what gets sent — the edited
 * body is passed to the send call rather than the server re-reading a stored draft the
 * user has since changed.
 */
export const ProposalCard: React.FC<Props> = ({ proposal, onSend, onDismiss }) => {
  const [draft, setDraft] = useState(proposal.draftReply || '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'send' | 'dismiss' | null>(null);

  const act = async (kind: 'send' | 'dismiss') => {
    setBusy(kind);
    try {
      if (kind === 'send') await onSend(proposal.id, draft);
      else await onDismiss(proposal.id);
    } finally {
      setBusy(null);
    }
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
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 leading-relaxed"
          />
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
