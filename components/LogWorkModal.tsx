import React, { useEffect, useRef, useState } from 'react';
import { Loader2, PlusCircle, X } from 'lucide-react';
import { Task } from '../types';

interface LogWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Task) => Promise<void>;
}

/**
 * Record work you did outside the app.
 *
 * Everything else in the day's record arrives on its own — commits from the GitHub
 * scanner, Claude Code sessions from the SessionEnd hook. Work that leaves no such
 * trace (a call, a server fix over SSH, something done in a client's dashboard) had
 * no way in at all once the task list was removed, so it never reached the 16:30
 * report. This is that way in.
 *
 * Two fields, because that is exactly what the report renders: `splitProjectTitle`
 * cuts the stored title on " — " into a bold project and the line beneath it. Stored
 * in that shape, and with no subtasks, `narrateItem` returns the outcome verbatim —
 * so what you type is what the channel reads, with no AI call and nothing invented.
 */
export const LogWorkModal: React.FC<LogWorkModalProps> = ({ isOpen, onClose, onSave }) => {
  const [project, setProject] = useState('');
  const [outcome, setOutcome] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProject('');
    setOutcome('');
    setMinutes('');
    setError(null);
    // Focus after the modal is actually in the DOM, or the caret lands nowhere.
    const id = setTimeout(() => firstField.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); window.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const what = outcome.trim();
    if (!what) { setError('Say what you did.'); return; }

    const who = project.trim();
    const mins = parseInt(minutes, 10);
    const now = Date.now();

    setSaving(true);
    setError(null);
    try {
      await onSave({
        // A plain uuid, deliberately: the deterministic `gh-`/`agent-` ids exist so a
        // re-scan overwrites its own row. Nothing re-derives this one, so an id that
        // could collide with a later entry would silently replace it.
        id: crypto.randomUUID(),
        // " — " is the separator splitProjectTitle cuts on. Without a project the
        // whole title becomes the project and the line reads as one phrase, which is
        // the right fallback.
        title: who ? `${who} — ${what}` : what,
        workspace: 'job',   // manually logged work is always work
        energy: 'medium',
        status: 'done',
        // The point of the whole thing: the report window is bounded by completed_at,
        // so without this it is done but belongs to no day and reaches no report.
        completedAt: now,
        createdAt: now,
        estimatedTime: Number.isFinite(mins) && mins > 0 ? mins : undefined,
        // Tagged so it is visibly a hand entry next to scanner-derived work.
        tags: ['manual'],
        dependencies: [],
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-lg bg-surface border border-slate-700 rounded-2xl shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Log completed work</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              For work that leaves no commit and no session — it goes straight into today's report.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 space-y-4">
          <div>
            <label htmlFor="log-project" className="text-xs font-medium text-slate-400 block mb-1">
              Project <span className="text-slate-600">(optional)</span>
            </label>
            <input
              id="log-project"
              ref={firstField}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Hotpoint"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
            />
          </div>

          <div>
            <label htmlFor="log-outcome" className="text-xs font-medium text-slate-400 block mb-1">
              What you did
            </label>
            <textarea
              id="log-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              rows={3}
              placeholder="Restored the staging database and reran the failed imports."
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full resize-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Written as you type it — past tense reads best, since this is what the report posts.
            </p>
          </div>

          <div>
            <label htmlFor="log-minutes" className="text-xs font-medium text-slate-400 block mb-1">
              Time spent <span className="text-slate-600">(optional, minutes)</span>
            </label>
            <input
              id="log-minutes"
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="45"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-32"
            />
          </div>

          {error && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Log it'}
          </button>
        </div>
      </form>
    </div>
  );
};
