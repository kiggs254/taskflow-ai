import React, { useState } from 'react';
import { DraftTask, WorkspaceType, EnergyLevel } from '../types';
import { CheckCircle2, X, Pencil, Mail, MessageSquare, Hash, Calendar, Clock, Tag } from 'lucide-react';

interface DraftTaskCardProps {
  draft: DraftTask;
  onApprove: (id: number, edits?: Partial<DraftTask>) => void;
  onReject: (id: number) => void;
  onEdit: (id: number, edits: Partial<DraftTask>) => void;
  token: string;
}

export const DraftTaskCard: React.FC<DraftTaskCardProps> = ({
  draft,
  onApprove,
  onReject,
  onEdit,
  token,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);
  const [editDescription, setEditDescription] = useState(draft.description || '');
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceType>(draft.workspace || 'personal');
  const [editEnergy, setEditEnergy] = useState<EnergyLevel>(draft.energy || 'medium');
  const [editEstimatedTime, setEditEstimatedTime] = useState(draft.estimatedTime?.toString() || '');
  const [editTags, setEditTags] = useState(draft.tags.join(', ') || '');
  const [editDueDate, setEditDueDate] = useState(
    draft.dueDate ? new Date(draft.dueDate).toISOString().split('T')[0] : ''
  );

  const handleSave = () => {
    const tagsArray = editTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const dueDateTimestamp = editDueDate ? new Date(`${editDueDate}T12:00:00Z`).getTime() : undefined;
    
    onEdit(draft.id, {
      title: editTitle,
      description: editDescription || undefined,
      workspace: editWorkspace,
      energy: editEnergy,
      estimatedTime: editEstimatedTime ? parseInt(editEstimatedTime, 10) : undefined,
      tags: tagsArray,
      dueDate: dueDateTimestamp,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(draft.title);
    setEditDescription(draft.description || '');
    setEditWorkspace(draft.workspace || 'personal');
    setEditEnergy(draft.energy || 'medium');
    setEditEstimatedTime(draft.estimatedTime?.toString() || '');
    setEditTags(draft.tags.join(', ') || '');
    setEditDueDate(draft.dueDate ? new Date(draft.dueDate).toISOString().split('T')[0] : '');
    setIsEditing(false);
  };

  const energyColors = {
    high: 'border-l-accent bg-accent/5',
    medium: 'border-l-warning bg-warning/5',
    low: 'border-l-success bg-success/5',
  };

  const sourceIcon = draft.source === 'gmail' ? Mail : draft.source === 'slack' ? Hash : MessageSquare;
  const SourceIcon = sourceIcon;

  if (isEditing) {
    return (
      <div className="p-4 rounded-xl bg-surface border border-primary border-l-4 mb-3 shadow-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              placeholder="Task title"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none resize-y"
              placeholder="Task description (optional)"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Workspace</label>
              <select
                value={editWorkspace}
                onChange={(e) => setEditWorkspace(e.target.value as WorkspaceType)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              >
                <option value="personal">Personal</option>
                <option value="job">Job</option>
                <option value="freelance">Freelance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Energy</label>
              <select
                value={editEnergy}
                onChange={(e) => setEditEnergy(e.target.value as EnergyLevel)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Estimated Time (minutes)
              </label>
              <input
                type="number"
                value={editEstimatedTime}
                onChange={(e) => setEditEstimatedTime(e.target.value)}
                min="1"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
                placeholder="15"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Due Date
              </label>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none"
              placeholder="tag1, tag2, tag3"
            />
            <p className="text-xs text-slate-500 mt-1">Separate tags with commas</p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-blue-600 transition-colors flex-1"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl bg-surface border border-slate-700 border-l-4 mb-3 ${
      energyColors[draft.energy || 'medium']
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <SourceIcon className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500 capitalize">{draft.source}</span>
          {draft.aiConfidence && (
            <span className="text-xs text-slate-500">
              ({Math.round(draft.aiConfidence * 100)}% confidence)
            </span>
          )}
        </div>
      </div>
      
      <h3 className="text-white font-medium mb-2">{draft.title}</h3>
      
      {draft.description && (
        <p className="text-sm text-slate-400 mb-3 line-clamp-2">{draft.description}</p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {draft.workspace && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs">
            {draft.workspace}
          </span>
        )}
        {draft.energy && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs">
            {draft.energy} energy
          </span>
        )}
        {draft.estimatedTime && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs">
            {draft.estimatedTime} min
          </span>
        )}
        {draft.tags.map(tag => (
          <span key={tag} className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs">
            #{tag}
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onApprove(draft.id)}
          className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Approve
        </button>
        <button
          onClick={() => setIsEditing(true)}
          className="px-3 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 flex items-center gap-2"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onReject(draft.id)}
          className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 flex items-center gap-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
