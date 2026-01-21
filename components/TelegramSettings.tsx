import React, { useState, useEffect } from 'react';
import { MessageSquare, CheckCircle2, X, Copy, Bell } from 'lucide-react';
import { api } from '../services/apiService';
import { ConfirmationModal } from './ConfirmationModal';
import { AlertModal } from './AlertModal';

interface TelegramSettingsProps {
  token: string;
}

export const TelegramSettings: React.FC<TelegramSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<any>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({ isOpen: false, title: '', message: '', type: 'info' });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await api.telegram.status(token);
      setStatus(data);
      if (data.connected && data.notificationsEnabled !== undefined) {
        setNotificationsEnabled(data.notificationsEnabled);
      }
    } catch (error) {
      console.error('Failed to load Telegram status:', error);
    }
  };

  const handleGetLinkCode = async () => {
    setLoading(true);
    try {
      const result = await api.telegram.getLinkCode(token);
      setLinkCode(result.code);
    } catch (error) {
      console.error('Failed to get link code:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to get link code. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (linkCode) {
      navigator.clipboard.writeText(linkCode);
      setAlertModal({ isOpen: true, title: 'Code Copied', message: `Link code copied! Send /link ${linkCode} to the bot on Telegram.`, type: 'success' });
    }
  };

  const handleUnlink = () => {
    setUnlinkConfirm(true);
  };

  const confirmUnlink = async () => {
    setUnlinkConfirm(false);
    setLoading(true);
    try {
      await api.telegram.unlink(token);
      setStatus({ connected: false });
      setLinkCode(null);
      setAlertModal({ isOpen: true, title: 'Success', message: 'Telegram unlinked successfully.', type: 'success' });
    } catch (error) {
      console.error('Failed to unlink Telegram:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to unlink Telegram.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async () => {
    setLoading(true);
    try {
      await api.telegram.updateSettings(token, { notificationsEnabled });
      setAlertModal({ isOpen: true, title: 'Success', message: 'Settings updated successfully!', type: 'success' });
      loadStatus();
    } catch (error) {
      console.error('Failed to update settings:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to update settings.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!status) {
    return <div className="text-slate-400">Loading...</div>;
  }

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">Telegram Integration</h2>
      </div>

      {status.connected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            <span>Connected as @{status.telegramUsername || 'user'}</span>
          </div>

          {status.linkedAt && (
            <div className="text-sm text-slate-400">
              Linked: {new Date(status.linkedAt).toLocaleString()}
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-800 border-slate-700"
              />
              <span className="text-sm text-slate-300 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Enable notifications for overdue tasks
              </span>
            </label>
            <button
              onClick={handleUpdateSettings}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>

          <button
            onClick={handleUnlink}
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            Unlink Telegram
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-slate-400">
            Link your Telegram account to manage tasks and receive notifications.
          </p>
          
          {linkCode ? (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-slate-800 border border-slate-700">
                <p className="text-sm text-slate-400 mb-2">Your linking code:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-slate-900 text-primary font-mono text-lg">
                    {linkCode}
                  </code>
                  <button
                    onClick={handleCopyCode}
                    className="px-3 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-700/30">
                <p className="text-sm text-blue-300">
                  1. Open Telegram and search for the TaskFlow bot<br/>
                  2. Send: <code className="bg-slate-800 px-1 rounded">/link {linkCode}</code>
                </p>
              </div>
            </div>
          ) : (
            <button
              onClick={handleGetLinkCode}
              disabled={loading}
              className="w-full px-4 py-3 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-5 h-5" />
              {loading ? 'Generating...' : 'Get Link Code'}
            </button>
          )}
        </div>
      )}

      {/* Unlink Confirmation Modal */}
      <ConfirmationModal
        isOpen={unlinkConfirm}
        title="Unlink Telegram"
        message="Are you sure you want to unlink Telegram? You will need to link again to use Telegram features."
        confirmText="Unlink"
        cancelText="Cancel"
        variant="warning"
        onConfirm={confirmUnlink}
        onCancel={() => setUnlinkConfirm(false)}
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
