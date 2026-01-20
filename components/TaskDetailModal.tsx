import React from 'react';
import { Task } from '../types';
import { X, Calendar, Clock, Tag, Link as LinkIcon, Zap, Brain, Coffee, Repeat } from 'lucide-react';

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  onComplete?: (id: string) => void;
  onUpdate?: (task: Task) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  onClose,
  onComplete,
  onUpdate,
}) => {
  const energyIcons = {
    high: <Zap className="w-5 h-5 text-accent" />,
    medium: <Brain className="w-5 h-5 text-warning" />,
    low: <Coffee className="w-5 h-5 text-success" />,
  };

  const energyColors = {
    high: 'text-accent',
    medium: 'text-warning',
    low: 'text-success',
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Not set';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-slate-700 p-6 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              {energyIcons[task.energy]}
              <span className={`text-sm uppercase tracking-wider font-semibold ${energyColors[task.energy]}`}>
                {task.energy} Energy
              </span>
              {task.status === 'waiting' && (
                <span className="text-xs text-amber-400 flex items-center gap-1 px-2 py-1 bg-amber-400/10 rounded">
                  Waiting
                </span>
              )}
              {task.status === 'done' && (
                <span className="text-xs text-emerald-400 flex items-center gap-1 px-2 py-1 bg-emerald-400/10 rounded">
                  Completed
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Workspace */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Workspace</h3>
            <p className="text-white capitalize">{task.workspace}</p>
          </div>

          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Description</h3>
              <p className="text-slate-300 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            {task.dueDate && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Due Date
                </h3>
                <p className="text-white">{formatDate(task.dueDate)}</p>
                {formatTime(task.dueDate) && (
                  <p className="text-slate-400 text-sm">{formatTime(task.dueDate)}</p>
                )}
              </div>
            )}
            {task.createdAt && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Created
                </h3>
                <p className="text-white">{formatDate(task.createdAt)}</p>
                {formatTime(task.createdAt) && (
                  <p className="text-slate-400 text-sm">{formatTime(task.createdAt)}</p>
                )}
              </div>
            )}
            {task.completedAt && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Completed
                </h3>
                <p className="text-white">{formatDate(task.completedAt)}</p>
                {formatTime(task.completedAt) && (
                  <p className="text-slate-400 text-sm">{formatTime(task.completedAt)}</p>
                )}
              </div>
            )}
            {task.snoozedUntil && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Snoozed Until
                </h3>
                <p className="text-white">{formatDate(task.snoozedUntil)}</p>
                {formatTime(task.snoozedUntil) && (
                  <p className="text-slate-400 text-sm">{formatTime(task.snoozedUntil)}</p>
                )}
              </div>
            )}
          </div>

          {/* Estimated Time */}
          {task.estimatedTime && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Estimated Time
              </h3>
              <p className="text-white">{task.estimatedTime} minutes</p>
            </div>
          )}

          {/* Recurrence */}
          {task.recurrence && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <Repeat className="w-4 h-4" />
                Recurrence
              </h3>
              <p className="text-white">
                {task.recurrence.frequency === 'daily' && 'Daily'}
                {task.recurrence.frequency === 'weekly' && 'Weekly'}
                {task.recurrence.frequency === 'monthly' && 'Monthly'}
                {task.recurrence.interval && ` (every ${task.recurrence.interval})`}
              </p>
            </div>
          )}

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 rounded-md bg-slate-800 text-slate-300 text-sm"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {task.dependencies && task.dependencies.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                <LinkIcon className="w-4 h-4" />
                Dependencies
              </h3>
              <p className="text-slate-300 text-sm">
                This task depends on {task.dependencies.length} other task{task.dependencies.length > 1 ? 's' : ''}
              </p>
            </div>
          )}

          {/* Task ID */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Task ID</h3>
            <p className="text-slate-400 text-xs font-mono">{task.id}</p>
          </div>
        </div>

        {/* Footer Actions */}
        {task.status !== 'done' && onComplete && (
          <div className="sticky bottom-0 bg-surface border-t border-slate-700 p-6 flex gap-3">
            <button
              onClick={() => {
                onComplete(task.id);
                onClose();
              }}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            >
              Mark as Complete
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        )}
        {task.status === 'done' && (
          <div className="sticky bottom-0 bg-surface border-t border-slate-700 p-6">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
