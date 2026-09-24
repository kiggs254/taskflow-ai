import React, { useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, X } from 'lucide-react';
import { api } from '../services/apiService';

interface Props {
  item: any;
  token: string;
  onSaved: () => void | Promise<void>;
}

/**
 * One line of today's record, correctable in place.
 *
 * Both halves are derived — the heading from the task title, the paragraph written by AI
 * — and both are regenerated: a GitHub or agent task is rebuilt by syncTask on every
 * scan, and End Day Reset re-writes narratives outright. So an edit is stored as an
 * override the generators do not touch, which is what makes it survive to the 16:30 send
 * rather than lasting until the next scan.
 */
export const DoneItemCard: React.FC<Props> = ({ item, token, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [project, setProject] = useState(item.project || item.title || '');
  const [narrative, setNarrative] = useState(item.narrative || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    // Seeded from what is on screen, so editing starts from the text being corrected
    // rather than from whatever was last typed and abandoned.
    setProject(item.project || item.title || '');
    setNarrative(item.narrative || '');
    setError(null);
    setEditing(true);
  };

  const save = async (values: { project: string; narrative: string }) => {
    setSaving(true);
    setError(null);
    try {
      await api.reports.editItem(token, item.id, values);
      await onSaved();
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the edit');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="bg-surface border border-slate-700 rounded-xl p-4 group">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-slate-100 min-w-0">{item.project || item.title}</p>
          <button
            onClick={open}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors shrink-0"
            title="Correct what the report says about this"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
        {item.narrative && (
          <p className="text-sm text-slate-400 mt-1 leading-relaxed">{item.narrative}</p>
        )}
        {item.edited && (
          <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Edited</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-primary/50 rounded-xl p-4 space-y-2">
      <label className="text-[11px] font-medium text-slate-400 block">Heading</label>
      <input
        value={project}
        onChange={(e) => setProject(e.target.value)}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold text-slate-100"
      />

      <label className="text-[11px] font-medium text-slate-400 block pt-1">What it says</label>
      <textarea
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        rows={4}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 leading-relaxed"
      />

      {error && <p className="text-[11px] text-amber-400">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => save({ project, narrative })}
          disabled={saving}
          className="flex items-center gap-1.5 bg-primary hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2 py-1.5 transition-colors disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        {item.edited && (
          /* Clearing both overrides hands the item back to the generators, so the next
             scan or wrap-up rewrites it. The way out of a bad edit, not just out of the
             form. */
          <button
            onClick={() => save({ project: '', narrative: '' })}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white px-2 py-1.5 ml-auto transition-colors disabled:opacity-50"
            title="Discard the edit and let it be written automatically again"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        This is what goes out in the daily report, not just what shows here.
      </p>
    </div>
  );
};
