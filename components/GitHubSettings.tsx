import React, { useEffect, useMemo, useState } from 'react';
import { Github, RefreshCw, Loader2, GitCommit, Plus, AlertTriangle, Building2, User } from 'lucide-react';
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
  installationId: number | null;
  accessLostAt?: string | null;
  accountLogin?: string | null;
}

interface Account {
  installationId: number | null;
  accountLogin: string | null;
  accountType: string | null;   // 'User' | 'Organization'
  authorLogin: string | null;
  lastScanAt?: string | null;
  scanFrequency?: number;
  enabled?: boolean;
  lastError?: string | null;
  repoCount: number;
  selectedCount: number;
}

interface Status {
  connected: boolean;
  configured: boolean;
  accounts?: Account[];
  repos?: Repo[];
  repoError?: string | null;
  authorLogins?: string[];
  authorLoginMissing?: boolean;
}

type Alert = { isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' };

interface ScanResult {
  commitsIngested?: number;
  tasksCreated?: number;
  authorLogins?: string[];
  reposScanned?: number;
  commitsMatched?: number;   // in today's window AND authored by one of authorLogins
  commitsInWindow?: number;  // in today's window at all, whoever wrote them
}

/**
 * Say why a scan found nothing.
 *
 * A flat "No new commits since the last scan" is three different outcomes wearing one
 * sentence: the repos were quiet, the commits were already recorded, or the author
 * filter matched nobody. Only the last is a fault, and it is invisible — it's how an
 * account name sitting in the wrong field silently zeroed commit tracking. The scan
 * now reports what it filtered on and what it saw, so the answer is on screen rather
 * than in a server log.
 */
const describeScan = (result: ScanResult): string => {
  const ingested = result.commitsIngested ?? 0;
  const tasks = result.tasksCreated ?? 0;
  if (ingested > 0) {
    return `Found ${ingested} new commit${ingested === 1 ? '' : 's'} across ${tasks} task${tasks === 1 ? '' : 's'}.`;
  }

  const authors = result.authorLogins ?? [];
  const matched = result.commitsMatched ?? 0;
  const inWindow = result.commitsInWindow ?? 0;
  const repos = result.reposScanned ?? 0;
  const by = authors.length ? authors.join(' or ') : 'anyone';

  // Commits exist today, but none are attributed to the configured author.
  if (matched === 0 && inWindow > 0) {
    return (
      `${repos} repo${repos === 1 ? '' : 's'} scanned. There are commits today, but none by ` +
      `${by} — so nothing was recorded. Check "Commit author login" above: it must be the ` +
      `GitHub username you commit as, not the account that owns the repos.`
    );
  }

  if (matched === 0) {
    return `No commits at all today in the ${repos} repo${repos === 1 ? '' : 's'} being tracked (filtering by ${by}).`;
  }

  return `Found ${matched} commit${matched === 1 ? '' : 's'} today by ${by}, all already recorded.`;
};

export const GitHubSettings: React.FC<GitHubSettingsProps> = ({ token }) => {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<number | 'all' | null>(null);
  const [savingRepos, setSavingRepos] = useState(false);
  const [refreshing, setRefreshing] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Keyed by installation id so two accounts' author fields can't overwrite each other.
  const [authorDrafts, setAuthorDrafts] = useState<Record<string, string>>({});
  const [disconnect, setDisconnect] = useState<{ installationId: number | null; label: string } | null>(null);
  const [alertModal, setAlertModal] = useState<Alert>({ isOpen: false, title: '', message: '', type: 'info' });

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    try {
      const result: Status = await api.github.status(token);
      setStatus(result);
      if (result.repos) {
        setSelected(new Set(result.repos.filter(r => r.selected).map(r => r.repoId)));
      }
      setAuthorDrafts(
        Object.fromEntries((result.accounts ?? []).map(a => [String(a.installationId), a.authorLogin ?? '']))
      );
    } catch (error) {
      console.error('Failed to load GitHub status:', error);
      setStatus({ connected: false, configured: true });
    }
  };

  const accounts = status?.accounts ?? [];
  const repos = status?.repos ?? [];

  // Grouped for display so it's obvious which account grants which repo — with two
  // accounts connected, a flat owner/name list stops being enough to tell them apart.
  const grouped = useMemo(() => {
    const byInstallation = new Map<string, Repo[]>();
    for (const repo of repos) {
      const key = String(repo.installationId);
      if (!byInstallation.has(key)) byInstallation.set(key, []);
      byInstallation.get(key)!.push(repo);
    }
    return byInstallation;
  }, [repos]);

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

  const refreshRepos = async (installationId?: number) => {
    setRefreshing(installationId ?? 'all');
    try {
      const result = await api.github.refreshRepos(token, installationId);
      await loadStatus();
      if (result.error) {
        setAlertModal({ isOpen: true, title: 'GitHub Refused', message: result.error, type: 'error' });
      } else if ((result.repos ?? []).length === 0) {
        setAlertModal({
          isOpen: true,
          title: 'No Repositories',
          message: 'GitHub returned no repositories. Check that the app is installed and granted access to at least one repo.',
          type: 'info',
        });
      }
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Refresh Failed', message: error.message, type: 'error' });
    } finally {
      setRefreshing(null);
    }
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

  const handleScanNow = async (installationId?: number) => {
    setScanning(installationId ?? 'all');
    try {
      const result = await api.github.scanNow(token, installationId);
      if (result.reason === 'no_repos') {
        setAlertModal({ isOpen: true, title: 'No Repos Selected', message: 'Pick at least one repository to track first.', type: 'info' });
      } else if (result.reason === 'not_connected') {
        setAlertModal({ isOpen: true, title: 'Not Connected', message: 'That GitHub account could not be authenticated. Try reconnecting it.', type: 'error' });
      } else {
        setAlertModal({ isOpen: true, title: 'Scan Complete', message: describeScan(result), type: 'success' });
      }
      await loadStatus();
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Scan Failed', message: error.message, type: 'error' });
    } finally {
      setScanning(null);
    }
  };

  const handleDisconnect = async () => {
    const target = disconnect;
    setDisconnect(null);
    if (!target) return;
    try {
      await api.github.disconnect(token, target.installationId ?? undefined);
      await loadStatus();
      setAlertModal({ isOpen: true, title: 'Disconnected', message: `${target.label} has been disconnected.`, type: 'success' });
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Error', message: error.message, type: 'error' });
    }
  };

  const saveAccountSetting = async (
    installationId: number | null,
    settings: { scanFrequency?: number; authorLogin?: string }
  ) => {
    try {
      const result: Status = await api.github.updateSettings(token, {
        installationId: installationId ?? undefined,
        ...settings,
      });
      setStatus(result);
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Save Failed', message: error.message, type: 'error' });
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
        <div className="space-y-6">
          {/* An empty author set means no commit is filtered out, so every contributor's
              work would be logged as yours. Loud, because the symptom otherwise shows up
              only in a report someone else reads. */}
          {status.authorLoginMissing && (
            <div className="flex gap-2.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                No commit author is set, so <strong>every</strong> commit in your tracked repos counts as yours —
                including your collaborators'. Set the commit author login on at least one account below.
              </span>
            </div>
          )}

          {status.repoError && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
              GitHub refused a repository list: {status.repoError}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-300">
                Connected accounts ({accounts.length})
              </h3>
              <button
                onClick={handleConnect}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-white transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add another account
              </button>
            </div>

            {accounts.map(account => {
              const key = String(account.installationId);
              const isOrg = account.accountType === 'Organization';
              const label = account.accountLogin ?? `Installation ${account.installationId}`;
              return (
                <div key={key} className="border border-slate-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {isOrg
                        ? <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        : <User className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="text-sm font-medium text-white truncate">{label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 shrink-0">
                        {isOrg ? 'Org' : 'Personal'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">
                      {account.selectedCount}/{account.repoCount} tracked
                    </span>
                  </div>

                  {account.lastError && (
                    <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
                      {account.lastError}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-slate-400 block mb-1">Commit author login</label>
                      <input
                        type="text"
                        value={authorDrafts[key] ?? ''}
                        placeholder={isOrg ? 'your GitHub username' : 'auto-detected'}
                        onChange={e => setAuthorDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                        onBlur={() => {
                          if ((authorDrafts[key] ?? '') !== (account.authorLogin ?? '')) {
                            saveAccountSetting(account.installationId, { authorLogin: authorDrafts[key] ?? '' });
                          }
                        }}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        {isOrg
                          ? 'An organisation cannot author a commit, so this has to be your own username.'
                          : 'Detected from the account; change it only if you commit under a different login.'}
                      </p>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-400 block mb-1">Scan every</label>
                      <select
                        value={account.scanFrequency ?? 30}
                        onChange={e => saveAccountSetting(account.installationId, { scanFrequency: Number(e.target.value) })}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
                      >
                        <option value={15}>15 minutes</option>
                        <option value={30}>30 minutes</option>
                        <option value={60}>1 hour</option>
                        <option value={180}>3 hours</option>
                      </select>
                      {account.lastScanAt && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Last scan: {new Date(account.lastScanAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <button
                      onClick={() => refreshRepos(account.installationId ?? undefined)}
                      disabled={refreshing !== null}
                      className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1"
                      title="Re-read this account's repository list from GitHub"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshing === account.installationId ? 'animate-spin' : ''}`} />
                      Refresh repos
                    </button>
                    <button
                      onClick={() => handleScanNow(account.installationId ?? undefined)}
                      disabled={scanning !== null}
                      className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      <GitCommit className={`w-3 h-3 ${scanning === account.installationId ? 'animate-pulse' : ''}`} />
                      Scan now
                    </button>
                    <button
                      onClick={() => setDisconnect({ installationId: account.installationId, label })}
                      className="text-xs text-slate-500 hover:text-red-400 transition-colors ml-auto"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">
                Tracked repositories ({selected.size}/{repos.length})
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => refreshRepos()}
                  disabled={refreshing !== null}
                  className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1"
                  title="Re-read every account's repository list from GitHub"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing === 'all' ? 'animate-spin' : ''}`} />
                  Refresh all
                </button>
                <button
                  onClick={saveRepos}
                  disabled={savingRepos}
                  className="text-xs font-semibold text-primary hover:text-white transition-colors disabled:opacity-50"
                >
                  {savingRepos ? 'Saving...' : 'Save selection'}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Commits you author in these repos become completed tasks — one per repo per branch per day, with each commit as a subtask.
            </p>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700/60">
              {repos.length === 0 ? (
                <p className="text-sm text-slate-500 p-3">
                  No repositories yet. If you just changed which repos the app can access on GitHub, hit Refresh all.
                </p>
              ) : (
                [...grouped.entries()].map(([installationId, group]) => (
                  <div key={installationId}>
                    <div className="px-3 py-1.5 bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500">
                      {group[0]?.accountLogin ?? `Installation ${installationId}`}
                    </div>
                    {group.map(repo => (
                      <label
                        key={repo.repoId}
                        className={`flex items-center gap-3 p-2.5 transition-colors ${
                          repo.accessLostAt ? 'opacity-60' : 'hover:bg-slate-800/60 cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(repo.repoId)}
                          disabled={Boolean(repo.accessLostAt)}
                          onChange={() => toggleRepo(repo.repoId)}
                          className="accent-primary w-4 h-4"
                        />
                        <span className="text-sm text-slate-300 flex-1 truncate">
                          <span className="text-slate-500">{repo.owner}/</span>{repo.name}
                        </span>
                        {repo.accessLostAt ? (
                          <span className="text-[10px] uppercase tracking-wider text-amber-400 shrink-0">
                            No access
                          </span>
                        ) : repo.defaultBranch ? (
                          <span className="text-[10px] uppercase tracking-wider text-slate-600 shrink-0">
                            {repo.defaultBranch}
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
            {repos.some(r => r.accessLostAt) && (
              <p className="text-[11px] text-slate-500 mt-2">
                "No access" means the app can no longer see that repo — it was transferred, or its access was
                revoked. Its history is kept. If it moved to an organisation, add that account above and it
                will reconnect to the same records.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleScanNow()}
              disabled={scanning !== null}
              className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${scanning === 'all' ? 'animate-spin' : ''}`} />
              {scanning === 'all' ? 'Scanning...' : 'Scan all accounts'}
            </button>
            <button
              onClick={() => setDisconnect({ installationId: null, label: 'Every GitHub account' })}
              className="text-slate-400 hover:text-red-400 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Disconnect all
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Connect GitHub to turn your commits into completed tasks automatically. You'll pick exactly
            which repositories to track, and TaskFlow only ever gets <strong className="text-slate-300">read access</strong> to their contents.
            You can connect several accounts — a personal one and your organisation, say — and track repos on all of them at once.
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
        isOpen={disconnect !== null}
        title={disconnect?.installationId === null ? 'Disconnect every account?' : 'Disconnect this account?'}
        message={
          disconnect?.installationId === null
            ? 'Commit tracking stops for all connected GitHub accounts. Tasks already created from commits are kept.'
            : `Commit tracking stops for ${disconnect?.label}. Your other accounts and their tracked repos are unaffected, and tasks already created from commits are kept.`
        }
        confirmText="Disconnect"
        variant="danger"
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnect(null)}
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
