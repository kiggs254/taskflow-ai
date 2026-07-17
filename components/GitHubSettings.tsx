import React, { useEffect, useState } from 'react';
import { Github, CheckCircle2, RefreshCw, Loader2, GitCommit } from 'lucide-react';
import { api } from '../services/apiService';
import { ConfirmationModal } from './ConfirmationModal';
import { AlertModal } from './AlertModal';

interface GitHubSettingsProps {
  token: string;
}

interface Repo {
  repoId: number;
  owner: string;
  name: string;
  defaultBranch?: string;
  selected: boolean;
  lastPolledAt?: string | null;
}

export const GitHubSettings: React.FC<GitHubSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [savingRepos, setSavingRepos] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scanFrequency, setScanFrequency] = useState(30);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    isOpen: false, title: '', message: '', type: 'info',
  });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const result = await api.github.status(token);
      setStatus(result);
      if (result.scanFrequency) setScanFrequency(result.scanFrequency);
      if (result.repos) {
        setSelected(new Set(result.repos.filter((r: Repo) => r.selected).map((r: Repo) => r.repoId)));
      }
    } catch (error) {
      console.error('Failed to load GitHub status:', error);
      setStatus({ connected: false, configured: true });
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await api.github.connect(token);
      window.location.href = result.authUrl;
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Connection Failed', message: error.message || 'Could not start GitHub connection.', type: 'error' });
      setLoading(false);
    }
  };

  const toggleRepo = (repoId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(repoId) ? next.delete(repoId) : next.add(repoId);
      return next;
    });
  };

  const saveRepos = async () => {
    setSavingRepos(true);
    try {
      await api.github.setRepos(token, Array.from(selected));
      await loadStatus();
      setAlertModal({ isOpen: true, title: 'Saved', message: `Now tracking ${selected.size} repo${selected.size === 1 ? '' : 's'}.`, type: 'success' });
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Save Failed', message: error.message, type: 'error' });
    } finally {
      setSavingRepos(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const result = await api.github.scanNow(token);
      if (result.reason === 'no_repos') {
        setAlertModal({ isOpen: true, title: 'No Repos Selected', message: 'Pick at least one repository to track first.', type: 'info' });
      } else {
        setAlertModal({
          isOpen: true,
          title: 'Scan Complete',
          message: result.commitsIngested > 0
            ? `Found ${result.commitsIngested} new commit${result.commitsIngested === 1 ? '' : 's'} across ${result.tasksCreated} task${result.tasksCreated === 1 ? '' : 's'}.`
            : 'No new commits since the last scan.',
          type: 'success',
        });
      }
      await loadStatus();
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Scan Failed', message: error.message, type: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectConfirm(false);
    try {
      await api.github.disconnect(token);
      await loadStatus();
      setAlertModal({ isOpen: true, title: 'Disconnected', message: 'GitHub has been disconnected.', type: 'success' });
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Error', message: error.message, type: 'error' });
    }
  };

  const handleFrequencyChange = async (value: number) => {
    setScanFrequency(value);
    try {
      await api.github.updateSettings(token, { scanFrequency: value });
    } catch (error) {
      console.error('Failed to update scan frequency:', error);
    }
  };

  if (!status) {
    return <div className="text-slate-400">Loading...</div>;
  }

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Github className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">GitHub Integration</h2>
      </div>

      {status.configured === false ? (
        <p className="text-slate-400 text-sm">
          GitHub is not configured on the server. Set <code className="text-slate-300">GITHUB_APP_ID</code>,{' '}
          <code className="text-slate-300">GITHUB_APP_SLUG</code> and{' '}
          <code className="text-slate-300">GITHUB_APP_PRIVATE_KEY</code>, then reload.
        </p>
      ) : status.connected ? (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle2 className="w-5 h-5" />
            <span>Connected{status.login ? ` as ${status.login}` : ''}</span>
          </div>

          {status.lastScanAt && (
            <p className="text-sm text-slate-400">
              Last scan: {new Date(status.lastScanAt).toLocaleString()}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">
                Tracked repositories ({selected.size}/{status.repos?.length ?? 0})
              </label>
              <button
                onClick={saveRepos}
                disabled={savingRepos}
                className="text-xs font-semibold text-primary hover:text-white transition-colors disabled:opacity-50"
              >
                {savingRepos ? 'Saving...' : 'Save selection'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Commits you author in these repos become completed tasks — one per repo per day, with each commit as a subtask.
            </p>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700/60">
              {(status.repos ?? []).length === 0 ? (
                <p className="text-sm text-slate-500 p-3">
                  No repositories available. Re-run the GitHub install and grant access to the repos you want tracked.
                </p>
              ) : (
                (status.repos as Repo[]).map(repo => (
                  <label
                    key={repo.repoId}
                    className="flex items-center gap-3 p-2.5 hover:bg-slate-800/60 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(repo.repoId)}
                      onChange={() => toggleRepo(repo.repoId)}
                      className="accent-primary w-4 h-4"
                    />
                    <span className="text-sm text-slate-300 flex-1 truncate">
                      <span className="text-slate-500">{repo.owner}/</span>{repo.name}
                    </span>
                    {repo.defaultBranch && (
                      <span className="text-[10px] uppercase tracking-wider text-slate-600">{repo.defaultBranch}</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Scan every</label>
            <select
              value={scanFrequency}
              onChange={e => handleFrequencyChange(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={180}>3 hours</option>
            </select>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleScanNow}
              disabled={scanning}
              className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Now'}
            </button>
            <button
              onClick={() => setDisconnectConfirm(true)}
              className="text-slate-400 hover:text-red-400 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Connect GitHub to turn your commits into completed tasks automatically. You'll pick exactly
            which repositories to track, and TaskFlow only ever gets <strong className="text-slate-300">read access</strong> to their contents.
          </p>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCommit className="w-4 h-4" />}
            Connect GitHub
          </button>
        </div>
      )}

      <ConfirmationModal
        isOpen={disconnectConfirm}
        title="Disconnect GitHub?"
        message="Commit tracking will stop. Tasks already created from commits are kept."
        confirmText="Disconnect"
        variant="danger"
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnectConfirm(false)}
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={() => setAlertModal({ ...alertModal, isOpen: false })}
      />
    </div>
  );
};
