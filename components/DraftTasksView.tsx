import React, { useState, useEffect } from 'react';
import { DraftTask } from '../types';
import { api } from '../services/apiService';
import { DraftTaskCard } from './DraftTaskCard';
import { Mail, MessageSquare, CheckCircle2, X, Hash } from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal';
import { AlertModal } from './AlertModal';

interface DraftTasksViewProps {
  token: string;
  onDraftCountChange?: (count: number) => void;
}

export const DraftTasksView: React.FC<DraftTasksViewProps> = ({ token, onDraftCountChange }) => {
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rejectConfirm, setRejectConfirm] = useState<{ isOpen: boolean; draftId: number | null }>({ isOpen: false, draftId: null });
  const [bulkApproveConfirm, setBulkApproveConfirm] = useState<{ isOpen: boolean; count: number }>({ isOpen: false, count: 0 });
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({ isOpen: false, title: '', message: '', type: 'info' });

  useEffect(() => {
    loadDrafts();
  }, [selectedStatus]);

  // Graceful polling for drafts when viewing this page (every 15 seconds)
  useEffect(() => {
    const pollDrafts = async () => {
      try {
        const data = await api.draftTasks.getAll(token, selectedStatus);
        
        // Update drafts gracefully - merge new drafts and update existing ones
        setDrafts(prevDrafts => {
          const draftMap = new Map(prevDrafts.map(d => [d.id, d]));
          const newDrafts: typeof data = [];
          
          data.forEach(fetchedDraft => {
            const existingDraft = draftMap.get(fetchedDraft.id);
            if (existingDraft) {
              // Update existing draft if it changed
              if (JSON.stringify(existingDraft) !== JSON.stringify(fetchedDraft)) {
                draftMap.set(fetchedDraft.id, fetchedDraft);
              }
            } else {
              // New draft
              newDrafts.push(fetchedDraft);
            }
          });

          // Remove drafts that no longer exist
          const fetchedDraftIds = new Set(data.map(d => d.id));
          const removedDrafts = prevDrafts.filter(d => !fetchedDraftIds.has(d.id));

          // Return merged array
          return Array.from(draftMap.values()).concat(newDrafts);
        });
        
        // Update parent component with pending count
        if (onDraftCountChange && selectedStatus === 'pending') {
          onDraftCountChange(data.length);
        }
      } catch (error) {
        console.error('Failed to poll draft tasks:', error);
      }
    };

    // Poll immediately, then every 15 seconds
    pollDrafts();
    const interval = setInterval(pollDrafts, 15000);
    
    return () => clearInterval(interval);
  }, [selectedStatus, token, onDraftCountChange]);

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
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to approve draft task.', type: 'error' });
    }
  };

  const handleReject = async (id: number) => {
    setRejectConfirm({ isOpen: true, draftId: id });
  };

  const confirmReject = async () => {
    if (!rejectConfirm.draftId) return;
    const id = rejectConfirm.draftId;
    setRejectConfirm({ isOpen: false, draftId: null });
    
    try {
      await api.draftTasks.reject(token, id);
      await loadDrafts();
      // Update count
      if (onDraftCountChange && selectedStatus === 'pending') {
        onDraftCountChange(drafts.length - 1);
      }
    } catch (error) {
      console.error('Failed to reject draft:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to reject draft task.', type: 'error' });
    }
  };

  const handleEdit = async (id: number, edits: Partial<DraftTask>) => {
    try {
      await api.draftTasks.edit(token, id, edits);
      await loadDrafts();
    } catch (error) {
      console.error('Failed to edit draft:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to edit draft task.', type: 'error' });
    }
  };

  const handleBulkApprove = async () => {
    const pendingDrafts = drafts.filter(d => d.status === 'pending');
    if (pendingDrafts.length === 0) return;
    
    setBulkApproveConfirm({ isOpen: true, count: pendingDrafts.length });
  };

  const confirmBulkApprove = async () => {
    const pendingDrafts = drafts.filter(d => d.status === 'pending');
    setBulkApproveConfirm({ isOpen: false, count: 0 });
    
    try {
      await api.draftTasks.bulkApprove(token, pendingDrafts.map(d => d.id));
      await loadDrafts();
    } catch (error) {
      console.error('Failed to bulk approve:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to bulk approve drafts.', type: 'error' });
    }
  };

  const gmailCount = drafts.filter(d => d.source === 'gmail').length;
  const telegramCount = drafts.filter(d => d.source === 'telegram').length;
  const slackCount = drafts.filter(d => d.source === 'slack').length;

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
          {(gmailCount > 0 || telegramCount > 0 || slackCount > 0) && (
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
              {slackCount > 0 && (
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4" />
                  {slackCount} from Slack
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

      {/* Reject Confirmation Modal */}
      <ConfirmationModal
        isOpen={rejectConfirm.isOpen}
        title="Reject Draft Task"
        message="Are you sure you want to reject this draft task? This action cannot be undone."
        confirmText="Reject"
        cancelText="Cancel"
        variant="warning"
        onConfirm={confirmReject}
        onCancel={() => setRejectConfirm({ isOpen: false, draftId: null })}
      />

      {/* Bulk Approve Confirmation Modal */}
      <ConfirmationModal
        isOpen={bulkApproveConfirm.isOpen}
        title="Approve All Drafts"
        message={`Are you sure you want to approve all ${bulkApproveConfirm.count} pending drafts?`}
        confirmText="Approve All"
        cancelText="Cancel"
        variant="info"
        onConfirm={confirmBulkApprove}
        onCancel={() => setBulkApproveConfirm({ isOpen: false, count: 0 })}
      />

      {/* Alert Modal */}
      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={() => setAlertModal({ isOpen: false, title: '', message: '', type: 'info' })}
      />
    </div>
  );
};
