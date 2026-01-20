import React, { useState } from 'react';
import { DraftTask, WorkspaceType, EnergyLevel } from '../types';
import { CheckCircle2, X, Pencil, Mail, MessageSquare, Hash } from 'lucide-react';

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
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceType>(draft.workspace || 'personal');
  const [editEnergy, setEditEnergy] = useState<EnergyLevel>(draft.energy || 'medium');

  const handleSave = () => {
    onEdit(draft.id, {
      title: editTitle,
      workspace: editWorkspace,
      energy: editEnergy,
    });
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
      <div className="p-4 rounded-xl bg-surface border border-slate-700 border-l-4 mb-3">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 mb-3"
          placeholder="Task title"
        />
        <div className="flex gap-2 mb-3">
          <select
            value={editWorkspace}
            onChange={(e) => setEditWorkspace(e.target.value as WorkspaceType)}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700"
          >
            <option value="personal">Personal</option>
            <option value="job">Job</option>
            <option value="freelance">Freelance</option>
          </select>
          <select
            value={editEnergy}
            onChange={(e) => setEditEnergy(e.target.value as EnergyLevel)}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(false)}
            className="px-3 py-1 rounded text-sm text-slate-400 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 rounded text-sm bg-primary text-white"
          >
            Save
          </button>
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
