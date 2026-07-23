import React, { useEffect, useState } from 'react';
import { Send, Loader2, Clock, Eye } from 'lucide-react';
import { api } from '../services/apiService';
import { AlertModal } from './AlertModal';

interface ReportSettingsProps {
  token: string;
}

interface Settings {
  timezone: string;
  reportTime: string;
  emailEnabled: boolean;
  slackEnabled: boolean;
  slackChannel: string;
  requireCommits: boolean;
  lastSentOn?: string | null;
}

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({
  checked, onChange, label, hint,
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <p className="text-sm text-slate-200">{label}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-primary' : 'bg-slate-700'}`}
      aria-pressed={checked}
      aria-label={label}
    >
      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-6' : ''}`} />
    </button>
  </div>
);

export const ReportSettings: React.FC<ReportSettingsProps> = ({ token }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    isOpen: false, title: '', message: '', type: 'info',
  });

  useEffect(() => {
    api.reports.settings(token).then(setSettings).catch(err => {
      console.error('Failed to load report settings:', err);
    });
  }, [token]);

  const patch = async (update: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...update };
    setSettings(next); // optimistic
    try {
      setSettings(await api.reports.updateSettings(token, update));
    } catch (error: any) {
      setSettings(settings); // roll back
      setAlertModal({ isOpen: true, title: 'Save Failed', message: error.message, type: 'error' });
    }
  };

  // Show exactly what today's report contains, before anything is sent. Reads the
  // same endpoint the 16:30 job uses, so this is the real payload rather than a
  // separate rendering that could drift from it.
  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      setPreview(await api.reports.completedToday(token));
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Preview Failed', message: error.message, type: 'error' });
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => { loadPreview(); }, [token]);

  const sendTest = async () => {
    setSending(true);
    try {
      const result = await api.reports.sendNow(token);
      if (!result.sent) {
        const why = result.reason === 'nothing_completed'
          ? "You haven't completed anything today, so there's nothing to report."
          : `Nothing was delivered. ${JSON.stringify(result.results ?? {})}`;
        setAlertModal({ isOpen: true, title: 'Not Sent', message: why, type: 'info' });
      } else {
        const channels = Object.entries(result.results ?? {})
          .filter(([, v]: any) => v.ok)
          .map(([k]) => k)
          .join(' and ');
        setAlertModal({
          isOpen: true,
          title: 'Report Sent',
          message: `Sent ${result.report.tasks} task(s) via ${channels || 'no channel'}.`,
          type: 'success',
        });
      }
    } catch (error: any) {
      setAlertModal({ isOpen: true, title: 'Send Failed', message: error.message, type: 'error' });
    } finally {
      setSending(false);
    }
  };

  if (!settings) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Clock className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">End-of-Day Report</h2>
      </div>

      {/* What's actually going out. Previously the only way to find out was to send
          it -- to a team channel. */}
      <div className="mb-6 bg-slate-800/40 border border-slate-700/60 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-200">What will be sent today</h3>
          </div>
          <button
            onClick={loadPreview}
            disabled={loadingPreview}
            className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {loadingPreview ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {!preview ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : preview.items?.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing completed today yet — no report would be sent.
          </p>
        ) : (
          <>
            {settings.requireCommits && !preview.commitDerived && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-3">
                <strong>This would NOT send.</strong> "Only on days I commit code" is on, and
                nothing today came from a commit or a Claude Code session.
              </div>
            )}
            {/* Mirrors the real send: one short AI narrative per project, no per-commit
                checklist and no checkmarks. `project` and `narrative` come from the same
                endpoint the 16:30 job renders, so this preview is faithful. */}
            <div className="space-y-3">
              {preview.items.map((item: any) => (
                <div key={item.id} className="text-xs min-w-0">
                  <div className="text-slate-100 font-semibold">
                    {item.project || item.title}
                    {item.fromCommits && (
                      <span className="ml-2 text-[10px] font-normal bg-primary/20 text-primary px-1.5 py-0.5 rounded align-middle">code</span>
                    )}
                    {item.fromAgent && (
                      <span className="ml-2 text-[10px] font-normal bg-slate-600/40 text-slate-300 px-1.5 py-0.5 rounded align-middle">claude code</span>
                    )}
                  </div>
                  {item.narrative && (
                    <p className="text-slate-400 mt-0.5 leading-relaxed">{item.narrative}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-700/60">
              {preview.counts?.tasks} task{preview.counts?.tasks === 1 ? '' : 's'}
              {preview.commitCount > 0 && `, ${preview.commitCount} from commits`}
              {preview.agentCount > 0 && `, ${preview.agentCount} from Claude Code`}
              {' — '}goes to{' '}
              {[settings.emailEnabled && 'email', settings.slackEnabled && `#${settings.slackChannel}`]
                .filter(Boolean).join(' and ') || 'nowhere (both channels off)'}
            </p>
          </>
        )}
      </div>

      <div className="space-y-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Send at</label>
            <input
              type="time"
              value={settings.reportTime}
              onChange={e => patch({ reportTime: e.target.value })}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Timezone</label>
            <input
              type="text"
              value={settings.timezone}
              onChange={e => patch({ timezone: e.target.value })}
              placeholder="Africa/Nairobi"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 w-full"
            />
          </div>
        </div>

        <Toggle
          label="Only send on days I commit code"
          hint="No commits that day means no report at all."
          checked={settings.requireCommits}
          onChange={v => patch({ requireCommits: v })}
        />

        <div className="h-px bg-slate-700" />

        <Toggle
          label="Email me the report"
          checked={settings.emailEnabled}
          onChange={v => patch({ emailEnabled: v })}
        />

        <Toggle
          label="Post to Slack"
          checked={settings.slackEnabled}
          onChange={v => patch({ slackEnabled: v })}
        />

        {settings.slackEnabled && (
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">Slack channel</label>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">#</span>
              <input
                type="text"
                value={settings.slackChannel ?? ''}
                onChange={e => setSettings({ ...settings, slackChannel: e.target.value })}
                onBlur={e => patch({ slackChannel: e.target.value })}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 flex-1"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">The app must be invited to this channel.</p>
          </div>
        )}

        <div className="h-px bg-slate-700" />

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            {settings.lastSentOn ? `Last sent: ${String(settings.lastSentOn).slice(0, 10)}` : 'Not sent yet.'}
          </p>
          <button
            onClick={sendTest}
            disabled={sending}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send test report
          </button>
        </div>
      </div>

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
