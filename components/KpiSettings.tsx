import React, { useEffect, useState } from 'react';
import { Gauge, Loader2, RefreshCw, Server } from 'lucide-react';
import { api } from '../services/apiService';
import { AlertModal } from './AlertModal';

interface Props { token: string }

interface Instance { id: string; name: string; slug: string; api_domain?: string | null }

/**
 * Where the monthly KPI report gets its fleet facts, and — the important part — WHICH
 * instances count as work. Most of the fleet is personal side projects, and their
 * downtime must never land in a work KPI score, so nothing is selected by default.
 */
export const KpiSettings: React.FC<Props> = ({ token }) => {
  const [settings, setSettings] = useState<any>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    isOpen: false, title: '', message: '', type: 'info',
  });

  useEffect(() => {
    api.kpi.settings(token).then((s) => {
      setSettings(s);
      setBaseUrl(s.fleetBaseUrl || '');
      setSheetId(s.sheetId || '');
      setSelected(new Set(s.workInstanceIds || []));
    }).catch((e) => console.error('KPI settings load failed', e));
  }, [token]);

  const loadInstances = async () => {
    setLoading(true);
    try {
      const data = await api.kpi.instances(token);
      setInstances(data.instances || []);
      if (data.selected?.length) setSelected(new Set(data.selected));
    } catch (e: any) {
      setAlert({ isOpen: true, title: 'Could not reach the fleet manager', message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {
        fleetBaseUrl: baseUrl,
        workInstanceIds: [...selected],
        sheetId,
      };
      // Only send the key when one was typed, so saving other fields can't blank it.
      if (apiKey.trim()) payload.fleetApiKey = apiKey.trim();
      const saved = await api.kpi.updateSettings(token, payload);
      setSettings(saved);
      setApiKey('');
      setAlert({ isOpen: true, title: 'Saved', message: 'KPI reporting settings updated.', type: 'success' });
    } catch (e: any) {
      setAlert({ isOpen: true, title: 'Save failed', message: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!settings) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Gauge className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-semibold text-white">Monthly KPI Reporting</h2>
      </div>

      <div className="space-y-5">
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1.5">Fleet manager URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://manager.example.com"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <p className="text-xs text-slate-500 mt-1.5">Your ebiz-manager instance — supplies uptime, incidents and vulnerabilities.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1.5">
            Fleet API key {settings.fleetApiKeySet && <span className="text-emerald-400 text-xs">· configured</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.fleetApiKeySet ? 'Leave blank to keep the current key' : 'KPI_API_KEY from ebiz-manager'}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>

        <div className="h-px bg-slate-700" />

        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium text-slate-300">Work instances</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Only these count toward your KPIs. Personal projects left unticked are ignored entirely.
              </p>
            </div>
            <button
              onClick={loadInstances}
              disabled={loading || !baseUrl}
              className="flex items-center gap-2 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Load fleet
            </button>
          </div>

          {instances === null ? (
            <p className="text-xs text-slate-500">
              {selected.size > 0 ? `${selected.size} instance(s) currently selected.` : 'Load the fleet to choose.'}
            </p>
          ) : instances.length === 0 ? (
            <p className="text-xs text-slate-500">No instances returned.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {instances.map((i) => (
                <label key={i.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/60 cursor-pointer">
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="accent-primary" />
                  <Server className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-sm text-slate-200 truncate">{i.name}</span>
                  <span className="text-xs text-slate-500 truncate ml-auto">{i.api_domain || i.slug}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-700" />

        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1.5">Google Sheet ID</label>
          <input
            type="text"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            placeholder="from the sheet URL: /spreadsheets/d/<THIS>/edit"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <p className="text-xs text-slate-500 mt-1.5">Each month is written to its own tab. Reconnect Gmail once to grant Sheets access.</p>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-primary hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save KPI settings
        </button>
      </div>

      <AlertModal
        isOpen={alert.isOpen}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        onClose={() => setAlert({ ...alert, isOpen: false })}
      />
    </div>
  );
};
