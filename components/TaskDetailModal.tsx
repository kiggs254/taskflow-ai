import React, { useMemo, useState, useRef } from 'react';
import { Task, Subtask, EnergyLevel, WorkspaceType, RecurrenceRule } from '../types';
import { X, Calendar, Clock, Tag, Link as LinkIcon, Zap, Brain, Coffee, Repeat, Pencil, Save, Mail, Users, Sparkles, Send, Plus, CheckSquare, Square, Trash2, ListTodo, Hourglass, AlarmClockOff, Sun, MoreHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertModal } from './AlertModal';
import { ConfirmationModal } from './ConfirmationModal';

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  onComplete?: (id: string, sendEmailReply?: boolean) => void;
  onUpdate?: (task: Task) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string, duration: 'hour' | 'day' | 'week') => void;
  onSetWaiting?: (id: string) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  onClose,
  onComplete,
  onUpdate,
  onDelete,
  onSnooze,
  onSetWaiting,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState(task.description || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [polishedMessage, setPolishedMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [selectedTone, setSelectedTone] = useState('professional');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [customToneInstructions, setCustomToneInstructions] = useState('');
  const [sendEmailReplyOnComplete, setSendEmailReplyOnComplete] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ 
    isOpen: false, title: '', message: '', type: 'info' 
  });
  const messageEditorRef = useRef<HTMLTextAreaElement>(null);
  
  // Edit form state
  const [editTitle, setEditTitle] = useState(task.title);
  const [editEnergy, setEditEnergy] = useState<EnergyLevel>(task.energy);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceType>(task.workspace);
  const [editDueDate, setEditDueDate] = useState(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  const [editRecurrence, setEditRecurrence] = useState<RecurrenceRule | undefined>(task.recurrence);
  
  // Subtask state
  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks || []);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Extract email metadata if this is a Gmail task
  const isGmailTask = task.tags?.includes('gmail');
  const emailMetadata = useMemo(() => {
    if (!isGmailTask || !task.description) return null;
    const metadataMatch = task.description.match(/<!-- Email metadata: ({.*?}) -->/);
    if (!metadataMatch) return null;
    try {
      return JSON.parse(metadataMatch[1]);
    } catch {
      return null;
    }
  }, [task.description, isGmailTask]);

  // Keep local state in sync when switching tasks
  useMemo(() => {
    setIsEditing(false);
    setEditDescription(task.description || '');
    setEditTitle(task.title);
    setEditEnergy(task.energy);
    setEditWorkspace(task.workspace);
    setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
    setEditRecurrence(task.recurrence);
    setSubtasks(task.subtasks || []);
    setNewSubtaskTitle('');
    return null;
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Subtask handlers
  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const newSubtask: Subtask = {
      id: crypto.randomUUID(),
      title: newSubtaskTitle.trim(),
      completed: false,
    };
    const updatedSubtasks = [...subtasks, newSubtask];
    setSubtasks(updatedSubtasks);
    setNewSubtaskTitle('');
    if (onUpdate) {
      onUpdate({ ...task, subtasks: updatedSubtasks });
    }
  };

  const toggleSubtask = (subtaskId: string) => {
    const updatedSubtasks = subtasks.map(st => 
      st.id === subtaskId 
        ? { ...st, completed: !st.completed, completedAt: !st.completed ? Date.now() : undefined }
        : st
    );
    setSubtasks(updatedSubtasks);
    if (onUpdate) {
      onUpdate({ ...task, subtasks: updatedSubtasks });
    }
  };

  const deleteSubtask = (subtaskId: string) => {
    const updatedSubtasks = subtasks.filter(st => st.id !== subtaskId);
    setSubtasks(updatedSubtasks);
    if (onUpdate) {
      onUpdate({ ...task, subtasks: updatedSubtasks });
    }
  };
  
  const handleRecurrenceChange = (key: keyof RecurrenceRule, value: any) => {
    const newRec: RecurrenceRule = editRecurrence || { frequency: 'weekly', interval: 1 };
    if (key === 'interval') {
      newRec.interval = parseInt(value, 10) || 1;
    } else {
      (newRec as any)[key] = value;
    }
    setEditRecurrence(newRec);
  };
  
  const handleSaveEdit = () => {
    if (!onUpdate) return;
    const newDueDate = editDueDate ? new Date(`${editDueDate}T12:00:00Z`).getTime() : undefined;
    onUpdate({
      ...task,
      title: editTitle,
      description: editDescription,
      energy: editEnergy,
      workspace: editWorkspace,
      dueDate: newDueDate,
      recurrence: editRecurrence,
      subtasks,
    });
    setIsEditing(false);
  };

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
            {isEditing ? (
              <>
                <div className="flex items-center gap-3 mb-3">
                  {energyIcons[editEnergy]}
                  <span className={`text-sm uppercase tracking-wider font-semibold ${energyColors[editEnergy]}`}>
                    {editEnergy} Energy
                  </span>
                </div>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-2xl font-bold text-white bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 focus:border-primary focus:outline-none"
                  autoFocus
                />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onUpdate && (
              <button
                onClick={() => setIsEditing((v) => !v)}
                className={`p-2 rounded-lg transition-colors ${isEditing ? 'bg-primary text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
                title={isEditing ? 'Stop editing' : 'Edit'}
              >
                <Pencil className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Edit Form Section - shown when editing */}
          {isEditing && (
            <div className="border border-primary/50 rounded-lg p-4 bg-primary/5 space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-1">Energy</label>
                  <select
                    value={editEnergy}
                    onChange={(e) => setEditEnergy(e.target.value as EnergyLevel)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary"
                  >
                    <option value="high">High Energy</option>
                    <option value="medium">Medium Energy</option>
                    <option value="low">Low Energy</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-slate-400 mb-1">Workspace</label>
                  <select
                    value={editWorkspace}
                    onChange={(e) => setEditWorkspace(e.target.value as WorkspaceType)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary"
                  >
                    <option value="job">Job</option>
                    <option value="freelance">Freelance</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs text-slate-400 mb-1">Due Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                </div>
              </div>
              
              {/* Recurrence */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editRecurrence}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditRecurrence({ frequency: 'weekly', interval: 1 });
                      } else {
                        setEditRecurrence(undefined);
                      }
                    }}
                    className="form-checkbox h-4 w-4 rounded bg-slate-700 border-slate-600 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-slate-300">Repeat task</span>
                </label>
                {editRecurrence && (
                  <div className="mt-2 pl-6 flex items-center gap-2 text-sm">
                    <span className="text-slate-400">Every</span>
                    <input
                      type="number"
                      min="1"
                      value={editRecurrence.interval}
                      onChange={(e) => handleRecurrenceChange('interval', e.target.value)}
                      className="w-16 bg-slate-800 border border-slate-700 rounded p-1 text-center text-white"
                    />
                    <select
                      value={editRecurrence.frequency}
                      onChange={(e) => handleRecurrenceChange('frequency', e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded p-1 text-slate-300 focus:outline-none"
                    >
                      <option value="daily">day(s)</option>
                      <option value="weekly">week(s)</option>
                      <option value="monthly">month(s)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 rounded-lg text-sm bg-primary text-white hover:bg-blue-600 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" /> Save Changes
                </button>
              </div>
            </div>
          )}

          {/* Workspace - only show when not editing */}
          {!isEditing && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Workspace</h3>
              <p className="text-white capitalize">{task.workspace}</p>
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Description</h3>
            {isEditing ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none resize-y"
                placeholder="Add details, notes, links, acceptance criteria..."
              />
            ) : (
              <div className="text-slate-300 prose prose-invert prose-sm max-w-none">
                {task.description && task.description.trim().length > 0 ? (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Style markdown elements
                      p: ({node, ...props}) => <p className="mb-2" {...props} />,
                      ul: ({node, ...props}) => <ul className="list-disc list-inside mb-2 space-y-1" {...props} />,
                      ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-2 space-y-1" {...props} />,
                      li: ({node, ...props}) => <li className="ml-2" {...props} />,
                      h1: ({node, ...props}) => <h1 className="text-xl font-bold mb-2 mt-4" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-lg font-bold mb-2 mt-4" {...props} />,
                      h3: ({node, ...props}) => <h3 className="text-base font-bold mb-2 mt-3" {...props} />,
                      code: ({node, ...props}) => <code className="bg-slate-800 px-1 py-0.5 rounded text-sm" {...props} />,
                      pre: ({node, ...props}) => <pre className="bg-slate-800 p-3 rounded mb-2 overflow-x-auto" {...props} />,
                      blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-slate-600 pl-4 italic my-2" {...props} />,
                      a: ({node, ...props}) => <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                  >
                    {task.description.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '')}
                  </ReactMarkdown>
                ) : (
                  <p>No description.</p>
                )}
              </div>
            )}
          </div>
          
          {/* Subtasks Section */}
          <div className="border border-slate-700 rounded-lg p-4 bg-slate-800/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <ListTodo className="w-4 h-4 text-primary" />
                Subtasks
                {subtasks.length > 0 && (
                  <span className="text-xs text-slate-400">
                    ({subtasks.filter(s => s.completed).length}/{subtasks.length} done)
                  </span>
                )}
              </h3>
            </div>
            
            {/* Subtasks List */}
            {subtasks.length > 0 ? (
              <div className="space-y-2 mb-4">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      subtask.completed ? 'bg-slate-800/50' : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    <button
                      onClick={() => toggleSubtask(subtask.id)}
                      className="flex-shrink-0"
                    >
                      {subtask.completed ? (
                        <CheckSquare className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400 hover:text-primary" />
                      )}
                    </button>
                    <span className={`flex-1 text-sm ${
                      subtask.completed ? 'text-slate-500 line-through' : 'text-white'
                    }`}>
                      {subtask.title}
                    </span>
                    <button
                      onClick={() => deleteSubtask(subtask.id)}
                      className="text-slate-500 hover:text-red-400 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm mb-4">No subtasks yet. Add one below.</p>
            )}
            
            {/* Add Subtask */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                    addSubtask();
                  }
                }}
                placeholder="Add a subtask..."
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-primary focus:outline-none text-sm"
              />
              <button
                onClick={addSubtask}
                disabled={!newSubtaskTitle.trim()}
                className="px-3 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-sm"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          </div>

          {/* Email Participants (for Gmail tasks) */}
          {isGmailTask && emailMetadata && (
            <div className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs uppercase tracking-wider text-slate-500">Email Thread</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-slate-500">Subject:</span>
                  <span className="text-slate-300 ml-2">{emailMetadata.subject}</span>
                </div>
                {emailMetadata.participants?.from && emailMetadata.participants.from.length > 0 && (
                  <div>
                    <span className="text-slate-500 flex items-center gap-1">
                      <Users className="w-3 h-3" /> From:
                    </span>
                    <div className="text-slate-300 ml-5 mt-1">
                      {emailMetadata.participants.from.map((email, idx) => (
                        <div key={idx} className="text-xs">{email}</div>
                      ))}
                    </div>
                  </div>
                )}
                {emailMetadata.participants?.to && emailMetadata.participants.to.length > 0 && (
                  <div>
                    <span className="text-slate-500">To:</span>
                    <div className="text-slate-300 ml-5 mt-1">
                      {emailMetadata.participants.to.map((email, idx) => (
                        <div key={idx} className="text-xs">{email}</div>
                      ))}
                    </div>
                  </div>
                )}
                {emailMetadata.participants?.cc && emailMetadata.participants.cc.length > 0 && (
                  <div>
                    <span className="text-slate-500">CC:</span>
                    <div className="text-slate-300 ml-5 mt-1">
                      {emailMetadata.participants.cc.map((email, idx) => (
                        <div key={idx} className="text-xs">{email}</div>
                      ))}
                    </div>
                  </div>
                )}
                {emailMetadata.date && (
                  <div>
                    <span className="text-slate-500">Date:</span>
                    <span className="text-slate-300 ml-2 text-xs">{new Date(emailMetadata.date).toLocaleString()}</span>
                  </div>
                )}
              </div>
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

          {/* Reply Section (for Gmail tasks) */}
          {isGmailTask && emailMetadata && (
            <div className="border border-slate-700 rounded-lg p-6 bg-gradient-to-br from-slate-800/50 to-slate-900/50">
              {!showReply ? (
                <button
                  onClick={() => setShowReply(true)}
                  className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all flex items-center justify-center gap-2 font-medium shadow-lg shadow-blue-500/20"
                >
                  <Mail className="w-4 h-4" /> Send an Update
                </button>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Mail className="w-5 h-5" />
                      Compose Reply
                    </h3>
                    <button
                      onClick={() => {
                        setShowReply(false);
                        setReplyMessage('');
                        setPolishedMessage('');
                        setSelectedTone('professional');
                        setCustomToneInstructions('');
                      }}
                      className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Email Subject */}
                  {emailMetadata?.subject && (
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Subject</label>
                      <input
                        type="text"
                        value={`Re: ${emailMetadata.subject}`}
                        readOnly
                        className="w-full px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-blue-500 focus:outline-none text-sm"
                      />
                    </div>
                  )}

                  {/* Message Editor */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Your Message</label>
                    <textarea
                      ref={messageEditorRef}
                      value={polishedMessage || replyMessage}
                      onChange={(e) => {
                        if (polishedMessage) {
                          setPolishedMessage(e.target.value);
                        } else {
                          setReplyMessage(e.target.value);
                        }
                      }}
                      rows={8}
                      className="w-full px-4 py-3 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-blue-500 focus:outline-none resize-y font-mono text-sm"
                      placeholder="Type your reply or generate an AI draft below..."
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      {(polishedMessage || replyMessage).length} characters
                    </div>
                  </div>

                  {/* AI Draft Generation Section */}
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-yellow-400" />
                      <h4 className="text-sm font-semibold text-white">Generate AI Draft</h4>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-2">Tone</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { value: 'professional', label: 'Professional' },
                            { value: 'casual', label: 'Casual' },
                            { value: 'friendly', label: 'Friendly' },
                            { value: 'concise', label: 'Concise' },
                            { value: 'urgent', label: 'Urgent' },
                          ].map((tone) => (
                            <button
                              key={tone.value}
                              onClick={() => setSelectedTone(tone.value)}
                              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                                selectedTone === tone.value
                                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                              }`}
                            >
                              {tone.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-2">Custom Instructions (optional)</label>
                        <textarea
                          value={customToneInstructions}
                          onChange={(e) => setCustomToneInstructions(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-blue-500 focus:outline-none resize-y text-sm"
                          placeholder="e.g., 'Include a call to action', 'Mention the deadline', 'Keep it under 100 words'"
                        />
                      </div>

                      <button
                        onClick={async () => {
                          setGeneratingDraft(true);
                          try {
                            const { api } = await import('../services/apiService');
                            const token = localStorage.getItem('taskflow_token');
                            if (!token) throw new Error('Not authenticated');
                            
                            const result = await api.gmail.generateDraft(token, {
                              taskId: task.id,
                              tone: selectedTone,
                              customInstructions: customToneInstructions || undefined,
                            });
                            
                            setReplyMessage(result.draft);
                            setPolishedMessage(''); // Clear polished message if exists
                            // Scroll message editor into view
                            setTimeout(() => {
                              messageEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                          } catch (error) {
                            console.error('Error generating draft:', error);
                            setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to generate draft: ' + (error as Error).message, type: 'error' });
                          } finally {
                            setGeneratingDraft(false);
                          }
                        }}
                        disabled={generatingDraft}
                        className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                      >
                        {generatingDraft ? (
                          <>
                            <Brain className="w-4 h-4 animate-pulse" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Generate Draft
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={async () => {
                        if (!replyMessage && !polishedMessage) return;
                        setSendingReply(true);
                        try {
                          const { api } = await import('../services/apiService');
                          const token = localStorage.getItem('taskflow_token');
                          if (!token) throw new Error('Not authenticated');
                          
                          await api.gmail.reply(token, {
                            taskId: task.id,
                            message: polishedMessage || replyMessage,
                            polishWithAI: false,
                            polishInstructions: '',
                          });
                          
                          setShowReply(false);
                          setReplyMessage('');
                          setPolishedMessage('');
                          setSelectedTone('professional');
                          setCustomToneInstructions('');
                          setAlertModal({ isOpen: true, title: 'Success', message: 'Reply sent successfully!', type: 'success' });
                        } catch (error) {
                          console.error('Error sending reply:', error);
                          setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to send reply: ' + (error as Error).message, type: 'error' });
                        } finally {
                          setSendingReply(false);
                        }
                      }}
                      disabled={sendingReply || (!replyMessage && !polishedMessage)}
                      className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium shadow-lg shadow-blue-500/20"
                    >
                      {sendingReply ? (
                        <>
                          <Brain className="w-4 h-4 animate-pulse" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send Reply
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
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
          <div className="sticky bottom-0 bg-surface border-t border-slate-700 p-6 space-y-3">
            {isGmailTask && emailMetadata && (
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={sendEmailReplyOnComplete}
                  onChange={(e) => setSendEmailReplyOnComplete(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                  Send AI-generated completion reply to email
                </span>
              </label>
            )}
            
            {/* Quick Actions */}
            {(onSnooze || onSetWaiting || onDelete) && (
              <div className="relative">
                <button
                  onClick={() => setShowQuickActions(!showQuickActions)}
                  className="w-full flex items-center justify-between px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <MoreHorizontal className="w-4 h-4" />
                    Quick Actions
                  </span>
                  <span className="text-xs text-slate-500">Snooze, Waiting, Delete</span>
                </button>
                
                {showQuickActions && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden z-50">
                    {/* Clear Waiting */}
                    {onSetWaiting && task.status !== 'waiting' && (
                      <button
                        onClick={() => {
                          onSetWaiting(task.id);
                          setShowQuickActions(false);
                          onClose();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700 transition-colors"
                      >
                        <Hourglass className="w-4 h-4 text-amber-400" />
                        <span className="text-sm text-slate-200">Set as Waiting</span>
                      </button>
                    )}
                    
                    {/* Snooze Options */}
                    {onSnooze && (
                      <>
                        <div className="px-4 py-2 text-xs text-slate-500 uppercase tracking-wider border-t border-slate-700">
                          Snooze...
                        </div>
                        <button
                          onClick={() => {
                            onSnooze(task.id, 'hour');
                            setShowQuickActions(false);
                            onClose();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700 transition-colors"
                        >
                          <AlarmClockOff className="w-4 h-4 text-blue-400" />
                          <span className="text-sm text-slate-200">For 1 Hour</span>
                        </button>
                        <button
                          onClick={() => {
                            onSnooze(task.id, 'day');
                            setShowQuickActions(false);
                            onClose();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700 transition-colors"
                        >
                          <Sun className="w-4 h-4 text-yellow-400" />
                          <span className="text-sm text-slate-200">Until Tomorrow</span>
                        </button>
                        <button
                          onClick={() => {
                            onSnooze(task.id, 'week');
                            setShowQuickActions(false);
                            onClose();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700 transition-colors"
                        >
                          <Calendar className="w-4 h-4 text-purple-400" />
                          <span className="text-sm text-slate-200">Until Next Week</span>
                        </button>
                      </>
                    )}
                    
                    {/* Delete */}
                    {onDelete && (
                      <button
                        onClick={() => {
                          setShowQuickActions(false);
                          setShowDeleteConfirm(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700 transition-colors border-t border-slate-700"
                      >
                        <X className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-red-400">Delete Task</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  onComplete(task.id, sendEmailReplyOnComplete);
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
      
      <AlertModal 
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={() => setAlertModal({ isOpen: false, title: '', message: '', type: 'info' })}
      />
      
      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title="Delete Task"
        message={`Are you sure you want to delete "${task.title}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => {
          if (onDelete) {
            onDelete(task.id);
            setShowDeleteConfirm(false);
            onClose();
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="danger"
      />
    </div>
  );
};
