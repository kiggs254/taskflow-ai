import React, { useState, useEffect } from 'react';
import { MessageSquare, CheckCircle2, X, RefreshCw, Settings } from 'lucide-react';
import { api } from '../services/apiService';

interface SlackSettingsProps {
  token: string;
}

export const SlackSettings: React.FC<SlackSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFrequency, setScanFrequency] = useState(15);

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
      alert('Failed to connect Slack. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Slack?')) return;
    
    setLoading(true);
    try {
      await api.slack.disconnect(token);
      setStatus({ connected: false });
    } catch (error) {
      console.error('Failed to disconnect Slack:', error);
      alert('Failed to disconnect Slack.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const result = await api.slack.scanNow(token);
      alert(`Scan complete! Found ${result.draftsCreated} potential tasks from mentions.`);
      loadStatus();
    } catch (error) {
      console.error('Failed to scan Slack mentions:', error);
      alert('Failed to scan Slack mentions. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const handleUpdateSettings = async () => {
    setLoading(true);
    try {
      await api.slack.updateSettings(token, { scanFrequency });
      alert('Settings updated successfully!');
      loadStatus();
    } catch (error) {
      console.error('Failed to update settings:', error);
      alert('Failed to update settings.');
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
    </div>
  );
};
