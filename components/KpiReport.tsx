import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clipboard, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../services/apiService';
import { AlertModal } from './AlertModal';

interface Props { token: string; onBack: () => void }

/** Previous calendar month as YYYY-MM — the one a month-end report is usually for. */
const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const SOURCE_STYLE: Record<string, string> = {
  auto: 'bg-emerald-500/15 text-emerald-400',
  fleet: 'bg-primary/20 text-primary',
  manual: 'bg-amber-500/15 text-amber-400',
};

export const KpiReport: React.FC<Props> = ({ token, onBack }) => {
  const [month, setMonth] = useState(lastMonth());
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [alert, setAlert] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info'; link?: { url: string; label: string } }>({
    isOpen: false, title: '', message: '', type: 'info',
  });

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    if (refresh) setReport(null);
    try {
      setReport(await api.kpi.monthly(token, month, refresh));
    } catch (e: any) {
      setAlert({ isOpen: true, title: 'Could not build the report', message: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, month]);

  useEffect(() => { load(false); }, [load]);

  // Every metric is derived now, so the thing worth surfacing is not "what must you
  // fill in" but "what had no data" -- a null is an absent measurement, not a zero.
  const notMeasured = useMemo(
    () => (report?.categories || []).flatMap((c: any) => c.metrics)
      .filter((m: any) => m.value === null || m.value === undefined).length,
    [report]
  );

  const copyTsv = async () => {
    try {
      const tsv = await api.kpi.monthlyTsv(token, month);
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setAlert({ isOpen: true, title: 'Copy failed', message: e.message, type: 'error' });
    }
  };

  const exportSheet = async () => {
    setExporting(true);
    try {
      const out = await api.kpi.exportSheet(token, month);
      setAlert({
        isOpen: true,
        title: 'Written to Google Sheets',
        message: `Tab "${out.tab}" ${out.created ? 'created' : 'updated'} — ${out.rows} rows.`,
        type: 'success',
        link: { url: `${out.url}#gid=0`, label: `Open ${out.tab}` },
      });
    } catch (e: any) {
      setAlert({ isOpen: true, title: 'Sheets export failed', message: e.message, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-white">Monthly Analytics</h1>
      </div>

      <div className="bg-surface border border-slate-700 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1.5">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Rebuild
        </button>
        <div className="flex-1" />
        <button onClick={copyTsv} disabled={!report}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Clipboard className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy for Sheets'}
        </button>
        <button onClick={exportSheet} disabled={!report || exporting}
          className="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Write to Sheet
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Reading commits and fleet data…</p>}
      {report?.generatedAt && !loading && (
        <p className="text-xs text-slate-500">
          Generated {new Date(report.generatedAt).toLocaleString()} · stored, so the figures stay put until you rebuild.
        </p>
      )}

      {report && (
        <>
          {/* Provenance up front: a manager validates these against system records, so
              what is measured and what still needs a human must be obvious. */}
          <div className="bg-surface border border-slate-700 rounded-xl p-4 text-xs text-slate-400 space-y-1">
            <p>
              <span className="text-slate-200 font-medium">{report.evidence.commits}</span> commits across{' '}
              <span className="text-slate-200 font-medium">{report.evidence.repos}</span> repo(s) ·{' '}
              {report.evidence.fleetConnected
                ? <span className="text-emerald-400">fleet data connected</span>
                : <span className="text-amber-400">fleet not connected</span>}
              {notMeasured > 0 && <> · <span className="text-amber-400">{notMeasured} metric(s) had no data</span></>}
            </p>
            {report.evidence.unconventionalCommits > 0 && (
              <p>
                {report.evidence.unconventionalCommits} commit(s) weren't conventional
                (<code>feat:</code>/<code>fix:</code>) so they aren't categorised — the counts below are a floor, not a total.
              </p>
            )}
            {report.evidence.fleetError && <p className="text-red-400">Fleet error: {report.evidence.fleetError}</p>}
          </div>

          {report.score?.overall != null && (
            <div className="bg-surface border border-slate-700 rounded-xl p-5 flex flex-wrap items-center gap-6">
              <div>
                <div className="text-3xl font-bold text-white">{report.score.overall}%</div>
                <div className="text-xs text-slate-500 mt-0.5">Overall score</div>
              </div>
              <div className="flex-1 min-w-[200px] grid grid-cols-2 sm:grid-cols-3 gap-3">
                {report.categories.map((c: any) => (
                  <div key={c.name}>
                    <div className="text-sm font-semibold text-slate-200">
                      {c.score == null ? <span className="text-slate-500">—</span> : `${c.score}%`}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{c.name} · {c.weight}%</div>
                  </div>
                ))}
              </div>
              {report.score.coverage < 100 && (
                <p className="text-[11px] text-amber-400 basis-full">
                  Based on {report.score.coverage}% of the weighting — the rest had no data and is not counted for or against you.
                </p>
              )}
            </div>
          )}

          {report.categories.map((c: any) => (
            <div key={c.name} className="bg-surface border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <h2 className="font-semibold text-white">{c.name}</h2>
                <span className="text-xs text-slate-400">
                  {c.weight}% of score
                  {c.score != null && <> · <span className="text-slate-200 font-medium">{c.score}%</span> ({c.metricsMet}/{c.metricsScored} targets met)</>}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">Metric</th>
                      <th className="px-4 py-2 font-medium">Target</th>
                      <th className="px-4 py-2 font-medium">Actual</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.metrics.map((m: any) => (
                      <tr key={m.metric} className="border-t border-slate-700/50">
                        <td className="px-4 py-2.5 text-slate-200">
                          {m.metric}
                          {m.note && <div className="text-[11px] text-slate-500 mt-0.5">{m.note}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{m.targetLabel ?? 'Tracked'}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {m.value === null || m.value === undefined
                            ? <span className="text-amber-400/70 italic">—</span>
                            : <span className="text-white font-medium">{String(m.value)}</span>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {m.status === 'met' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">met</span>}
                          {m.status === 'missed' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">missed</span>}
                          {m.status === 'no-data' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/30 text-slate-400">no data</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_STYLE[m.source] || ''}`}>
                            {m.source === 'manual' ? 'no source' : m.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}

      <AlertModal
        isOpen={alert.isOpen}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        link={alert.link}
        onClose={() => setAlert({ ...alert, isOpen: false })}
      />
    </div>
  );
};
