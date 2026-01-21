import React, { useState, useEffect } from 'react';
import { MessageSquare, CheckCircle2, X, RefreshCw, Settings, Bell } from 'lucide-react';
import { api } from '../services/apiService';
import { ConfirmationModal } from './ConfirmationModal';
import { AlertModal } from './AlertModal';

interface SlackSettingsProps {
  token: string;
}

export const SlackSettings: React.FC<SlackSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFrequency, setScanFrequency] = useState(15);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({ isOpen: false, title: '', message: '', type: 'info' });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await api.slack.status(token);
      setStatus(data);
      if (data.connected && data.scanFrequency) {
        setScanFrequency(data.scanFrequency);
      }
      if (data.connected && data.notificationsEnabled !== undefined) {
        setNotificationsEnabled(data.notificationsEnabled);
      }
    } catch (error) {
      console.error('Failed to load Slack status:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await api.slack.connect(token);
      window.location.href = result.authUrl;
    } catch (error) {
      console.error('Failed to connect Slack:', error);
      setAlertModal({ isOpen: true, title: 'Connection Error', message: 'Failed to connect Slack. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setDisconnectConfirm(true);
  };

  const confirmDisconnect = async () => {
    setDisconnectConfirm(false);
    setLoading(true);
    try {
      await api.slack.disconnect(token);
      setStatus({ connected: false });
      setAlertModal({ isOpen: true, title: 'Success', message: 'Slack disconnected successfully.', type: 'success' });
    } catch (error) {
      console.error('Failed to disconnect Slack:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to disconnect Slack.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const result = await api.slack.scanNow(token);
      const taskCount = result.tasksCreated || 0;
      setAlertModal({ isOpen: true, title: 'Scan Complete', message: `Added ${taskCount} task${taskCount !== 1 ? 's' : ''} to your Job list from Slack mentions.`, type: 'success' });
      loadStatus();
    } catch (error) {
      console.error('Failed to scan Slack mentions:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to scan Slack mentions. Please try again.', type: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const handleUpdateSettings = async () => {
    setLoading(true);
    try {
      await api.slack.updateSettings(token, { scanFrequency, notificationsEnabled });
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
        <h2 className="text-xl font-semibold text-white">Slack Integration</h2>
      </div>

      {status.connected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            <span>Connected to Slack workspace</span>
          </div>

          {status.lastScanAt && (
            <div className="text-sm text-slate-400">
              Last scan: {new Date(status.lastScanAt).toLocaleString()}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-slate-300">
                Scan Frequency (minutes)
              </label>
              <input
                type="number"
                value={scanFrequency}
                onChange={(e) => setScanFrequency(parseInt(e.target.value, 10))}
                min="5"
                max="60"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700"
              />
              <p className="text-xs text-slate-500">
                How often to check for new mentions (default: 15 minutes)
              </p>
            </div>

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
                  Enable Slack notifications
                </span>
              </label>
              <p className="text-xs text-slate-500 ml-6">
                Receive notifications in Slack when tasks are created from scans
              </p>
            </div>

            <button
              onClick={handleUpdateSettings}
              disabled={loading}
              className="w-full px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Update Settings
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleScanNow}
              disabled={scanning}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Now'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-slate-400">
            Connect your Slack workspace to automatically create tasks from mentions.
            When someone mentions you, AI will determine if it's a task and create a draft for approval.
          </p>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="w-full px-4 py-3 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-5 h-5" />
            {loading ? 'Connecting...' : 'Connect Slack'}
          </button>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      <ConfirmationModal
        isOpen={disconnectConfirm}
        title="Disconnect Slack"
        message="Are you sure you want to disconnect Slack? You will need to reconnect to continue monitoring mentions."
        confirmText="Disconnect"
        cancelText="Cancel"
        variant="warning"
        onConfirm={confirmDisconnect}
        onCancel={() => setDisconnectConfirm(false)}
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
