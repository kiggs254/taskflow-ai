import React, { useEffect, useState } from 'react';
import { DraftTask, EnergyLevel, WorkspaceType } from '../types';
import { X, Save, Calendar, Clock, Tag, Hash, Mail, MessageSquare, CheckCircle2 } from 'lucide-react';

interface DraftTaskDetailModalProps {
  draft: DraftTask;
  onClose: () => void;
  onSave: (id: number, edits: Partial<DraftTask>) => Promise<void> | void;
  onApprove: (id: number, edits?: Partial<DraftTask>) => Promise<void> | void;
  onReject: (id: number) => Promise<void> | void;
}

export const DraftTaskDetailModal: React.FC<DraftTaskDetailModalProps> = ({
  draft,
  onClose,
  onSave,
  onApprove,
  onReject,
}) => {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description || '');
  const [workspace, setWorkspace] = useState<WorkspaceType>(draft.workspace || 'personal');
  const [energy, setEnergy] = useState<EnergyLevel>(draft.energy || 'medium');
  const [estimatedTime, setEstimatedTime] = useState(draft.estimatedTime?.toString() || '');
  const [tags, setTags] = useState((draft.tags || []).join(', '));
  const [dueDate, setDueDate] = useState(draft.dueDate ? new Date(draft.dueDate).toISOString().split('T')[0] : '');

  useEffect(() => {
    setTitle(draft.title);
    setDescription(draft.description || '');
    setWorkspace(draft.workspace || 'personal');
    setEnergy(draft.energy || 'medium');
    setEstimatedTime(draft.estimatedTime?.toString() || '');
    setTags((draft.tags || []).join(', '));
    setDueDate(draft.dueDate ? new Date(draft.dueDate).toISOString().split('T')[0] : '');
  }, [draft.id]);

  const sourceIcon = draft.source === 'gmail' ? Mail : draft.source === 'slack' ? Hash : MessageSquare;
  const SourceIcon = sourceIcon;

  const buildEdits = (): Partial<DraftTask> => {
    const tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
    const dueDateTimestamp = dueDate ? new Date(`${dueDate}T12:00:00Z`).getTime() : undefined;
    return {
      title,
      description: description || undefined,
      workspace,
      energy,
      estimatedTime: estimatedTime ? parseInt(estimatedTime, 10) : undefined,
      tags: tagsArray,
      dueDate: dueDateTimestamp,
    };
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-slate-700 p-6 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <SourceIcon className="w-4 h-4" />
              <span className="text-xs capitalize">{draft.source}</span>
              {draft.aiConfidence != null && (
                <span className="text-xs">({Math.round(draft.aiConfidence * 100)}% confidence)</span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white">Draft Task</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none resize-y"
              placeholder="Full context/details..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">Workspace</label>
              <select
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value as WorkspaceType)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              >
                <option value="personal">Personal</option>
                <option value="job">Job</option>
                <option value="freelance">Freelance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">Energy</label>
              <select
                value={energy}
                onChange={(e) => setEnergy(e.target.value as EnergyLevel)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Estimated Time (min)
              </label>
              <input
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                type="number"
                min="1"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Due Date
              </label>
              <input
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                type="date"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
              <Tag className="w-4 h-4" /> Tags (comma-separated)
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              placeholder="tag1, tag2"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-slate-700 p-6 flex gap-3">
          <button
            onClick={() => onSave(draft.id, buildEdits())}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> Save
          </button>
          <button
            onClick={() => onApprove(draft.id, buildEdits())}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> Approve
          </button>
          <button
            onClick={() => onReject(draft.id)}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};

