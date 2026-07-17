import React, { useEffect, useState } from 'react';
import { Terminal, Plus, Trash2, Copy, Check, Loader2, FolderGit2 } from 'lucide-react';
import { api } from '../services/apiService';
import { AlertModal } from './AlertModal';
import { ConfirmationModal } from './ConfirmationModal';

interface AgentSettingsProps {
  token: string;
}

interface WorkPath {
  path: string;
  workspace: string;
}

interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt?: string | null;
  createdAt: string;
}

const WORKSPACES = ['job', 'freelance', 'personal'];

// The backend base URL, for the setup snippet.
//
// Must come from VITE_API_BASE_URL, not window.location.origin: the frontend is on
// Netlify and the API is on a different host entirely. Using the page origin
// produced a URL that *looks* right and returns HTTP 200 for everything, because
// Netlify's SPA fallback serves index.html for /api/* -- so the hook would silently
// parse HTML as JSON and never log a thing.
const apiBase = (() => {
  const configured = process.env.VITE_API_BASE_URL;
  if (!configured) return '';
  return configured.endsWith('/api') ? configured : `${configured.replace(/\/$/, '')}/api`;
})();

export const AgentSettings: React.FC<AgentSettingsProps> = ({ token }) => {
  const [enabled, setEnabled] = useState(true);
  const [workPaths, setWorkPaths] = useState<WorkPath[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newWorkspace, setNewWorkspace] = useState('job');
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    isOpen: false, title: '', message: '', type: 'info',
  });

  useEffect(() => {
    Promise.all([api.agent.settings(token), api.agent.tokens(token)])
      .then(([s, t]) => {
        setEnabled(s.enabled);
        setWorkPaths(s.workPaths || []);
        setTokens(t.tokens || []);
      })
      .catch(err => console.error('Failed to load agent settings:', err))
      .finally(() => setLoaded(true));
  }, [token]);

  const persist = async (next: { enabled?: boolean; workPaths?: WorkPath[] }) => {
    try {
      const saved = await api.agent.updateSettings(token, next);
      setEnabled(saved.enabled);
      setWorkPaths(saved.workPaths || []);
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Save Failed', message: error.message, type: 'error' });
    }
  };

  const addPath = async () => {
    const path = newPath.trim();
    if (!path.startsWith('/')) {
      setAlertModal({ isOpen: true, title: 'Absolute Path Needed', message: 'Use a full path, e.g. /Users/you/Projects', type: 'info' });
      return;
    }
    setNewPath('');
    await persist({ workPaths: [...workPaths, { path, workspace: newWorkspace }] });
  };

  const removePath = async (path: string) => {
    await persist({ workPaths: workPaths.filter(p => p.path !== path) });
  };

  const createToken = async () => {
    setCreating(true);
    try {
      const result = await api.agent.createToken(token, 'Claude Code');
      setFreshToken(result.token);
      setTokens(await api.agent.tokens(token).then(r => r.tokens));
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Failed', message: error.message, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const doRevoke = async () => {
    if (!revoking) return;
    const target = revoking;
    setRevoking(null);
    try {
      await api.agent.revokeToken(token, target.id);
      setTokens(tokens.filter(t => t.id !== target.id));
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Failed', message: error.message, type: 'error' });
    }
  };

  if (!loaded) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-2">
        <Terminal className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">Claude Code</h2>
      </div>
      <p className="text-sm text-slate-400 mb-6">
        Logs work you do in Claude Code as completed tasks — for anything Git doesn't already
        capture. Commits in tracked repos are skipped, so nothing is counted twice.
      </p>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-200">Enabled</p>
            <p className="text-xs text-slate-500 mt-0.5">Turn off to stop logging without removing your folders.</p>
          </div>
          <button
            onClick={() => persist({ enabled: !enabled })}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-primary' : 'bg-slate-700'}`}
            aria-pressed={enabled}
            aria-label="Enable Claude Code logging"
          >
            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'translate-x-6' : ''}`} />
          </button>
        </div>

        <div className="h-px bg-slate-700" />

        {/* Work folders */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <FolderGit2 className="w-4 h-4 text-slate-400" />
            <label className="text-sm font-medium text-slate-300">Work folders</label>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Only sessions inside these folders are logged. Everything else — personal projects,
            anything unlisted — is ignored entirely and never leaves your machine.
            The most specific folder wins, so you can put a personal sub-folder inside a work one.
          </p>

          {workPaths.length === 0 && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-3">
              No folders yet, so nothing is being logged. Add one to start.
            </div>
          )}

          <div className="space-y-2 mb-3">
            {workPaths.map(wp => (
              <div key={wp.path} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                <code className="text-xs text-slate-300 flex-1 truncate">{wp.path}</code>
                <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">{wp.workspace}</span>
                <button
                  onClick={() => removePath(wp.path)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                  aria-label={`Remove ${wp.path}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPath()}
              placeholder="/Users/you/Projects"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            />
            <select
              value={newWorkspace}
              onChange={e => setNewWorkspace(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 capitalize"
            >
              {WORKSPACES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <button
              onClick={addPath}
              className="bg-primary hover:bg-primary/80 text-white px-3 rounded-lg transition-colors"
              aria-label="Add work folder"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="h-px bg-slate-700" />

        {/* Tokens */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-slate-300">API tokens</label>
            <button
              onClick={createToken}
              disabled={creating}
              className="text-xs font-semibold text-primary hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Generate
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Used by the hook on your machine. Only works for logging work — it can't read your
            tasks or change settings.
          </p>

          {freshToken && (
            <div className="mb-3 bg-primary/10 border border-primary/40 rounded-lg p-3">
              <p className="text-xs text-slate-300 mb-2">
                Copy this now — it's stored hashed and can't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-primary bg-slate-900 rounded px-2 py-1.5 flex-1 truncate">{freshToken}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(freshToken);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-slate-400 hover:text-white transition-colors"
                  aria-label="Copy token"
                >
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {tokens.length === 0 && <p className="text-xs text-slate-500">No tokens yet.</p>}
            {tokens.map(t => (
              <div key={t.id} className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                <span className="text-sm text-slate-300">{t.name}</span>
                <code className="text-xs text-slate-500">{t.prefix}…</code>
                <span className="text-xs text-slate-600 flex-1 text-right">
                  {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </span>
                <button
                  onClick={() => setRevoking(t)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                  aria-label={`Revoke ${t.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Setup */}
        <details className="text-sm">
          <summary className="text-slate-400 hover:text-slate-200 cursor-pointer text-xs">
            Setup instructions
          </summary>
          <div className="mt-3 text-xs text-slate-400 space-y-2">
            <p>1. Add to your shell profile:</p>
            <pre className="bg-slate-900 rounded p-2.5 overflow-x-auto text-slate-300">
              {`export TASKFLOW_API_URL=${apiBase || 'https://your-backend/api'}\nexport TASKFLOW_TOKEN=tf_...`}
            </pre>
            <p>2. Copy the hooks and register them:</p>
            <pre className="bg-slate-900 rounded p-2.5 overflow-x-auto text-slate-300">{`cp agent-hooks/*.mjs ~/.claude/hooks/
chmod +x ~/.claude/hooks/taskflow-*.mjs`}</pre>
            <p>3. Add to <code className="text-slate-300">~/.claude/settings.json</code> — see <code className="text-slate-300">agent-hooks/README.md</code>.</p>
          </div>
        </details>
      </div>

      <ConfirmationModal
        isOpen={!!revoking}
        title={`Revoke "${revoking?.name}"?`}
        message="Any machine using this token stops logging immediately. This can't be undone."
        confirmText="Revoke"
        variant="danger"
        onConfirm={doRevoke}
        onCancel={() => setRevoking(null)}
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
