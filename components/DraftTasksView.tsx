import React, { useState, useEffect } from 'react';
import { DraftTask } from '../types';
import { api } from '../services/apiService';
import { DraftTaskCard } from './DraftTaskCard';
import { Mail, MessageSquare, CheckCircle2, X } from 'lucide-react';

interface DraftTasksViewProps {
  token: string;
  onDraftCountChange?: (count: number) => void;
}

export const DraftTasksView: React.FC<DraftTasksViewProps> = ({ token, onDraftCountChange }) => {
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    loadDrafts();
  }, [selectedStatus]);

  // Poll for new drafts when viewing this page (every 15 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      loadDrafts();
    }, 15000); // Poll every 15 seconds when on draft tasks view
    
    return () => clearInterval(interval);
  }, [selectedStatus]);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const data = await api.draftTasks.getAll(token, selectedStatus);
      setDrafts(data);
      
      // Update parent component with pending count
      if (onDraftCountChange && selectedStatus === 'pending') {
        onDraftCountChange(data.length);
      }
    } catch (error) {
      console.error('Failed to load draft tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number, edits?: Partial<DraftTask>) => {
    try {
      await api.draftTasks.approve(token, id, edits);
      await loadDrafts();
      // Notify parent to refresh tasks and update count
      if (onDraftCountChange) {
        const updatedDrafts = await api.draftTasks.getAll(token, 'pending');
        onDraftCountChange(updatedDrafts.length);
      }
    } catch (error) {
      console.error('Failed to approve draft:', error);
      alert('Failed to approve draft task.');
    }
  };

  const handleReject = async (id: number) => {
    if (!confirm('Are you sure you want to reject this draft task?')) return;
    
    try {
      await api.draftTasks.reject(token, id);
      await loadDrafts();
      // Update count
      if (onDraftCountChange && selectedStatus === 'pending') {
        onDraftCountChange(drafts.length - 1);
      }
    } catch (error) {
      console.error('Failed to reject draft:', error);
      alert('Failed to reject draft task.');
    }
  };

  const handleEdit = async (id: number, edits: Partial<DraftTask>) => {
    try {
      await api.draftTasks.edit(token, id, edits);
      await loadDrafts();
    } catch (error) {
      console.error('Failed to edit draft:', error);
      alert('Failed to edit draft task.');
    }
  };

  const handleBulkApprove = async () => {
    const pendingDrafts = drafts.filter(d => d.status === 'pending');
    if (pendingDrafts.length === 0) return;
    
    if (!confirm(`Approve all ${pendingDrafts.length} pending drafts?`)) return;
    
    try {
      await api.draftTasks.bulkApprove(token, pendingDrafts.map(d => d.id));
      await loadDrafts();
    } catch (error) {
      console.error('Failed to bulk approve:', error);
      alert('Failed to bulk approve drafts.');
    }
  };

  const gmailCount = drafts.filter(d => d.source === 'gmail').length;
  const telegramCount = drafts.filter(d => d.source === 'telegram').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-slate-400">Loading draft tasks...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Draft Tasks</h1>
          <p className="text-slate-400">
            Review and approve tasks extracted from Gmail and Telegram
          </p>
        </div>
        {selectedStatus === 'pending' && drafts.length > 0 && (
          <button
            onClick={handleBulkApprove}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve All ({drafts.length})
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-700">
        <button
          onClick={() => setSelectedStatus('pending')}
          className={`px-4 py-2 rounded-t-lg ${
            selectedStatus === 'pending'
              ? 'bg-surface text-white border-t border-l border-r border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Pending ({drafts.filter(d => d.status === 'pending').length})
        </button>
        <button
          onClick={() => setSelectedStatus('approved')}
          className={`px-4 py-2 rounded-t-lg ${
            selectedStatus === 'approved'
              ? 'bg-surface text-white border-t border-l border-r border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Approved
        </button>
        <button
          onClick={() => setSelectedStatus('rejected')}
          className={`px-4 py-2 rounded-t-lg ${
            selectedStatus === 'rejected'
              ? 'bg-surface text-white border-t border-l border-r border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Rejected
        </button>
      </div>

      {drafts.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No {selectedStatus} draft tasks</p>
        </div>
      ) : (
        <>
          {(gmailCount > 0 || telegramCount > 0) && (
            <div className="flex gap-4 text-sm text-slate-400">
              {gmailCount > 0 && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  {gmailCount} from Gmail
                </div>
              )}
              {telegramCount > 0 && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  {telegramCount} from Telegram
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {drafts.map((draft) => (
              <DraftTaskCard
                key={draft.id}
                draft={draft}
                onApprove={handleApprove}
                onReject={handleReject}
                onEdit={handleEdit}
                token={token}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
