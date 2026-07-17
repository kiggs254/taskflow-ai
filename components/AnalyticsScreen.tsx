import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart2, Loader2, Sparkles, TrendingUp, TrendingDown,
  Flame, GitCommit, Clock, AlertTriangle,
} from 'lucide-react';
import { api } from '../services/apiService';

/**
 * Analytics.
 *
 * Rewritten to read from GET /api/analytics/summary instead of deriving everything
 * from the full in-memory task array. That array was the reason the client held every
 * task ever created; the old screen also recomputed a 7 x O(n) scan on every render
 * with no memoisation, and rendered a hardcoded "You're in the top 10% of users this
 * week!" as if it were a real statistic.
 */

const RANGES = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '365d', label: '1 year' },
];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }> = ({
  label, value, hint, icon,
}) => (
  <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
    <div className="flex items-center gap-2 text-slate-400 mb-1.5">
      {icon}
      <span className="text-xs uppercase tracking-wider">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
);

const Bars: React.FC<{ data: { key: string; n: number }[]; title: string }> = ({ data, title }) => {
  const max = Math.max(1, ...data.map(d => d.n));
  if (!data.length) return null;
  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-300 mb-4">{title}</h3>
      <div className="space-y-2.5">
        {data.map(d => (
          <div key={d.key} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-24 truncate capitalize">{d.key}</span>
            <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(d.n / max) * 100}%` }} />
            </div>
            <span className="text-xs text-slate-500 w-8 text-right">{d.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const AnalyticsScreen: React.FC<{ token: string; onBack: () => void }> = ({ token, onBack }) => {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState<any>(null);
  const [narrative, setNarrative] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNarrative(null);

    api.analytics.summary(token, range)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Narrative is slower (a model call) and non-essential -- load it separately so
    // the numbers render immediately.
    api.analytics.narrative(token, range)
      .then(n => { if (!cancelled) setNarrative(n); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [token, range]);

  const heat = useMemo(() => {
    if (!data?.heatmap) return { grid: new Map<string, number>(), max: 1 };
    const grid = new Map<string, number>();
    let max = 1;
    for (const cell of data.heatmap) {
      grid.set(`${cell.dow}-${cell.hour}`, cell.n);
      max = Math.max(max, cell.n);
    }
    return { grid, max };
  }, [data]);

  const dayMax = useMemo(
    () => Math.max(1, ...(data?.perDay ?? []).map((d: any) => d.n)),
    [data]
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <BarChart2 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-white flex-1">Analytics</h1>
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/50 rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  range === r.key ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 py-20 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading analytics...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {/* Headline */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Completed" value={data.headline.completed} hint={`${data.headline.activeDays} active days`} />
              <Stat label="Completion rate" value={`${data.headline.completionRate}%`} hint={`${data.headline.open} still open`} />
              <Stat
                label="Streak"
                value={data.streaks.current}
                hint={`longest: ${data.streaks.longest} days`}
                icon={<Flame className="w-3.5 h-3.5 text-accent" />}
              />
              <Stat
                label="Median cycle"
                value={`${data.headline.medianCycleHours}h`}
                hint="created to completed"
                icon={<Clock className="w-3.5 h-3.5" />}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat
                label="Est. focus hours"
                value={data.headline.estimatedFocusHours}
                // Honest label: this sums estimates entered before the work, and never
                // measured anything.
                hint="from estimates, not tracked time"
              />
              <Stat
                label="Backlog"
                value={data.headline.backlogDelta > 0 ? `+${data.headline.backlogDelta}` : data.headline.backlogDelta}
                hint={data.headline.backlogDelta > 0 ? 'created faster than completed' : 'completing faster than creating'}
                icon={data.headline.backlogDelta > 0
                  ? <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  : <TrendingDown className="w-3.5 h-3.5 text-success" />}
              />
              <Stat
                label="Due-date reliability"
                value={data.headline.dueDateReliability === null ? '—' : `${data.headline.dueDateReliability}%`}
                hint="completed before due"
              />
              <Stat
                label="Stale tasks"
                value={data.aging.openOlderThan30d}
                hint="open more than 30 days"
              />
            </div>

            {/* AI narrative */}
            {narrative && !narrative.unavailable && narrative.headline && (
              <div className="bg-surface border border-primary/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-slate-200">Insights</h3>
                </div>
                <p className="text-slate-300 mb-4">{narrative.headline}</p>
                <div className="space-y-3">
                  {(narrative.insights ?? []).map((ins: any, i: number) => (
                    <div key={i} className="flex gap-3">
                      <div className={`w-1 rounded-full shrink-0 ${
                        ins.sentiment === 'positive' ? 'bg-success'
                          : ins.sentiment === 'negative' ? 'bg-accent' : 'bg-slate-600'
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{ins.title}</p>
                        <p className="text-sm text-slate-400">{ins.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {narrative.recommendation && (
                  <p className="text-sm text-slate-300 mt-4 pt-4 border-t border-slate-700">
                    <span className="text-primary font-semibold">Try this: </span>
                    {narrative.recommendation}
                  </p>
                )}
              </div>
            )}

            {/* Daily activity */}
            <div className="bg-surface border border-slate-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4">Completions per day</h3>
              <div className="flex items-end gap-1 h-32">
                {data.perDay.map((d: any) => (
                  <div key={d.day} className="flex-1 group relative flex flex-col justify-end h-full">
                    <div
                      className="bg-primary/70 group-hover:bg-primary rounded-t transition-colors"
                      style={{ height: `${(d.n / dayMax) * 100}%`, minHeight: '2px' }}
                    />
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {d.day}: {d.n}
                    </span>
                  </div>
                ))}
              </div>
              {data.perDay.length === 0 && <p className="text-sm text-slate-500">No completions in this range.</p>}
            </div>

            {/* Heatmap */}
            <div className="bg-surface border border-slate-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-1">When you finish work</h3>
              <p className="text-xs text-slate-500 mb-4">Local time ({data.timezone})</p>
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                  {DOW.map((label, dow) => (
                    <div key={dow} className="flex items-center gap-0.5 mb-0.5">
                      <span className="text-[10px] text-slate-500 w-8 shrink-0">{label}</span>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const n = heat.grid.get(`${dow}-${hour}`) ?? 0;
                        return (
                          <div
                            key={hour}
                            title={`${label} ${hour}:00 — ${n} completed`}
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{
                              backgroundColor: n === 0 ? 'rgb(30,41,59)' : `rgba(59,130,246,${0.25 + (n / heat.max) * 0.75})`,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                  <div className="flex items-center gap-0.5 mt-1">
                    <span className="w-8 shrink-0" />
                    {[0, 6, 12, 18].map(h => (
                      <span key={h} className="text-[9px] text-slate-600" style={{ width: `${3.5 * 6}px` }}>{h}:00</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Bars data={data.byWorkspace} title="By workspace" />
              <Bars data={data.byEnergy} title="By energy" />
            </div>

            {data.byTag.length > 0 && <Bars data={data.byTag} title="Top tags" />}

            {/* Commit correlation */}
            {data.commitsPerDay.length > 0 && (
              <div className="bg-surface border border-slate-700 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <GitCommit className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-slate-300">Code shipped</h3>
                </div>
                <p className="text-sm text-slate-400">
                  <strong className="text-white">
                    {data.commitsPerDay.reduce((n: number, d: any) => n + d.commits, 0)}
                  </strong>{' '}
                  commits across <strong className="text-white">{data.commitsPerDay.length}</strong> days.
                </p>
              </div>
            )}

            {/* Source attribution */}
            {data.draftOutcomes.length > 0 && (
              <div className="bg-surface border border-slate-700 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-1">Are your integrations useful?</h3>
                <p className="text-xs text-slate-500 mb-4">How often you approve what each source suggests.</p>
                <div className="space-y-3">
                  {data.draftOutcomes.map((s: any) => {
                    const total = s.approved + s.rejected;
                    const rate = total ? Math.round((s.approved / total) * 100) : null;
                    return (
                      <div key={s.source} className="flex items-center gap-3">
                        <span className="text-sm text-slate-300 w-20 capitalize">{s.source}</span>
                        <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-slate-800">
                          <div className="bg-success" style={{ width: `${total ? (s.approved / total) * 100 : 0}%` }} />
                          <div className="bg-accent" style={{ width: `${total ? (s.rejected / total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-28 text-right">
                          {rate === null ? 'no decisions' : `${rate}% kept (${s.approved}/${total})`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Self-comparison. Replaces a hardcoded "top 10% of users" line that was
                pure invention -- this compares the user only against their own history. */}
            {data.selfComparison.weeksCompared > 0 && (
              <div className="bg-surface border border-slate-700 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">This week vs. your own history</h3>
                <p className="text-slate-400 text-sm">
                  You've completed <strong className="text-white">{data.selfComparison.thisWeek}</strong> task
                  {data.selfComparison.thisWeek === 1 ? '' : 's'} this week
                  {data.selfComparison.best
                    ? ' — your best week in the last 90 days.'
                    : `, better than ${data.selfComparison.percentile}% of your last ${data.selfComparison.weeksCompared} weeks.`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
