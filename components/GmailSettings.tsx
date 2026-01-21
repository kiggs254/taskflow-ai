import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, X, RefreshCw, Settings } from 'lucide-react';
import { api } from '../services/apiService';
import { ConfirmationModal } from './ConfirmationModal';
import { AlertModal } from './AlertModal';

interface GmailSettingsProps {
  token: string;
}

export const GmailSettings: React.FC<GmailSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFrequency, setScanFrequency] = useState(60);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({ isOpen: false, title: '', message: '', type: 'info' });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await api.gmail.status(token);
      setStatus(data);
      if (data.connected && data.scanFrequency) {
        setScanFrequency(data.scanFrequency);
      }
    } catch (error) {
      console.error('Failed to load Gmail status:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await api.gmail.connect(token);
      window.location.href = result.authUrl;
    } catch (error) {
      console.error('Failed to connect Gmail:', error);
      setAlertModal({ isOpen: true, title: 'Connection Error', message: 'Failed to connect Gmail. Please try again.', type: 'error' });
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
      await api.gmail.disconnect(token);
      setStatus({ connected: false });
      setAlertModal({ isOpen: true, title: 'Success', message: 'Gmail disconnected successfully.', type: 'success' });
    } catch (error) {
      console.error('Failed to disconnect Gmail:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to disconnect Gmail.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const result = await api.gmail.scanNow(token);
      setAlertModal({ isOpen: true, title: 'Scan Complete', message: `Found ${result.draftsCreated} potential tasks.`, type: 'success' });
      loadStatus();
    } catch (error) {
      console.error('Failed to scan emails:', error);
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to scan emails. Please try again.', type: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const handleUpdateSettings = async () => {
    setLoading(true);
    try {
      await api.gmail.updateSettings(token, { scanFrequency });
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
        <Mail className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">Gmail Integration</h2>
      </div>

      {status.connected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            <span>Connected to {status.email}</span>
          </div>

          {status.lastScanAt && (
            <div className="text-sm text-slate-400">
              Last scan: {new Date(status.lastScanAt).toLocaleString()}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm text-slate-300">
              Scan Frequency (minutes)
            </label>
            <input
              type="number"
              value={scanFrequency}
              onChange={(e) => setScanFrequency(parseInt(e.target.value, 10))}
              min="15"
              max="1440"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white border border-slate-700"
            />
            <button
              onClick={handleUpdateSettings}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
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
            Connect your Gmail account to automatically extract tasks from your emails.
          </p>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="w-full px-4 py-3 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Mail className="w-5 h-5" />
            {loading ? 'Connecting...' : 'Connect Gmail'}
          </button>
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      <ConfirmationModal
        isOpen={disconnectConfirm}
        title="Disconnect Gmail"
        message="Are you sure you want to disconnect Gmail? You will need to reconnect to continue scanning emails."
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
