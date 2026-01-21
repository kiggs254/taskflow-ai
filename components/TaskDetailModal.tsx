import React, { useMemo, useState } from 'react';
import { Task } from '../types';
import { X, Calendar, Clock, Tag, Link as LinkIcon, Zap, Brain, Coffee, Repeat, Pencil, Save, Mail, Users, Sparkles, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState(task.description || '');
  const [showReply, setShowReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [polishWithAI, setPolishWithAI] = useState(false);
  const [polishInstructions, setPolishInstructions] = useState('');
  const [polishedMessage, setPolishedMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [selectedTone, setSelectedTone] = useState('professional');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [customToneInstructions, setCustomToneInstructions] = useState('');

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
    return null;
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="flex items-center gap-2">
            {onUpdate && (
              <button
                onClick={() => setIsEditing((v) => !v)}
                className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
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
          {/* Workspace */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Workspace</h3>
            <p className="text-white capitalize">{task.workspace}</p>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-500">Description</h3>
              {isEditing && onUpdate && (
                <button
                  onClick={() => {
                    onUpdate({ ...task, description: editDescription });
                    setIsEditing(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-blue-600 transition-colors flex items-center gap-2 text-xs"
                >
                  <Save className="w-3 h-3" /> Save
                </button>
              )}
            </div>

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
                  <Mail className="w-4 h-4" /> Reply All
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
                        setPolishWithAI(false);
                        setPolishInstructions('');
                        setPolishedMessage('');
                        setSelectedTone('professional');
                        setCustomToneInstructions('');
                      }}
                      className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
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
                            const token = localStorage.getItem('tf_token');
                            if (!token) throw new Error('Not authenticated');
                            
                            const result = await api.gmail.generateDraft(token, {
                              taskId: task.id,
                              tone: selectedTone,
                              customInstructions: customToneInstructions || undefined,
                            });
                            
                            setReplyMessage(result.draft);
                            setPolishedMessage(''); // Clear polished message if exists
                          } catch (error) {
                            console.error('Error generating draft:', error);
                            alert('Failed to generate draft: ' + (error as Error).message);
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

                  {/* Message Editor */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Your Message</label>
                    <textarea
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
                      placeholder="Type your reply or generate an AI draft above..."
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      {(polishedMessage || replyMessage).length} characters
                    </div>
                  </div>

                  {/* Polish Options */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={polishWithAI}
                        onChange={(e) => setPolishWithAI(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Polish with AI</span>
                    </label>
                    
                    {polishWithAI && (
                      <div>
                        <label className="block text-xs text-slate-400 mb-2">Polish Instructions (optional)</label>
                        <textarea
                          value={polishInstructions}
                          onChange={(e) => setPolishInstructions(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:border-blue-500 focus:outline-none resize-y text-sm"
                          placeholder="e.g., 'Make it more formal', 'Add more detail', 'Shorten it'"
                        />
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={async () => {
                        if (!replyMessage && !polishedMessage) return;
                        setSendingReply(true);
                        try {
                          const { api } = await import('../services/apiService');
                          const token = localStorage.getItem('tf_token');
                          if (!token) throw new Error('Not authenticated');
                          
                          await api.gmail.reply(token, {
                            taskId: task.id,
                            message: polishedMessage || replyMessage,
                            polishWithAI,
                            polishInstructions: polishInstructions || undefined,
                          });
                          
                          setShowReply(false);
                          setReplyMessage('');
                          setPolishWithAI(false);
                          setPolishInstructions('');
                          setPolishedMessage('');
                          setSelectedTone('professional');
                          setCustomToneInstructions('');
                          alert('Reply sent successfully!');
                        } catch (error) {
                          console.error('Error sending reply:', error);
                          alert('Failed to send reply: ' + (error as Error).message);
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
                    {polishWithAI && replyMessage && !polishedMessage && (
                      <button
                        onClick={async () => {
                          try {
                            const { api } = await import('../services/apiService');
                            const token = localStorage.getItem('tf_token');
                            if (!token) throw new Error('Not authenticated');
                            
                            const result = await api.gmail.polishReply(token, {
                              message: replyMessage,
                              instructions: polishInstructions || undefined,
                            });
                            
                            setPolishedMessage(result.polishedMessage);
                          } catch (error) {
                            console.error('Error polishing reply:', error);
                            alert('Failed to polish reply: ' + (error as Error).message);
                          }
                        }}
                        className="px-4 py-3 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Polish
                      </button>
                    )}
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
