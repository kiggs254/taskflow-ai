import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../services/apiService';
import { EmailProposal } from '../types';
import { ProposalCard } from './ProposalCard';
import { useAgentConsole } from './agentConsole/useAgentConsole';
import { summariseCounts } from '../services/agentStream';

/**
 * The assistant's home.
 *
 * Three things, in the order they matter: what wants a decision from you, what the
 * assistant is doing right now, and what actually got done today. Deliberately not a
 * backlog — the app stopped being a to-do list.
 */

const AgentActivity: React.FC<{ token: string; onOpen: () => void }> = ({ token, onOpen }) => {
  const { turns, status, configured, loadError } = useAgentConsole(token);

  // Not set up, or this account isn't on the console allowlist. Render nothing at all
  // rather than an error the user can do nothing about.
  if (configured === false || loadError) return null;

  const recent = turns.slice(0, 3);
  const working = status?.busy;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Activity className={`w-4 h-4 ${working ? 'text-emerald-400' : 'text-slate-500'}`} />
          Agent {working ? 'working' : 'idle'}
        </h2>
        <button onClick={onOpen} className="text-xs text-slate-400 hover:text-white transition-colors">
          Open console
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing run recently.</p>
      ) : (
        <div className="space-y-2">
          {recent.map((t) => (
            <button
              key={t.taskId}
              onClick={onOpen}
              className="w-full text-left bg-surface border border-slate-700 rounded-lg p-3 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    t.outcome === 'running' ? 'bg-emerald-400 animate-pulse'
                      : t.outcome === 'error' ? 'bg-red-400' : 'bg-slate-600'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">{t.userText || '(no prompt)'}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t.outcome === 'running' ? 'working…' : t.outcomeText || t.outcome} · {summariseCounts(t.tools.map((c) => c.tool))}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export const HomeScreen: React.FC<{ token: string; onOpenAgents: () => void }> = ({ token, onOpenAgents }) => {
  const [proposals, setProposals] = useState<EmailProposal[] | null>(null);
  const [done, setDone] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [p, d] = await Promise.allSettled([
        api.proposals.list(token),
        api.reports.completedToday(token, 'day'),
      ]);
      if (p.status === 'fulfilled') setProposals(p.value.proposals || []);
      // One failing must not blank the other -- allSettled, not all.
      if (d.status === 'fulfilled') setDone(d.value);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const send = async (id: number, draft: string) => {
    await api.proposals.send(token, id, draft);
    setProposals((prev) => (prev || []).filter((p) => p.id !== id));
  };
  const dismiss = async (id: number) => {
    await api.proposals.dismiss(token, id);
    setProposals((prev) => (prev || []).filter((p) => p.id !== id));
  };

  const doneItems = useMemo(() => done?.items ?? [], [done]);

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Today</h1>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {/* 1. What wants you */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-3">
          <Inbox className="w-4 h-4 text-primary" />
          Needs your reply
          {proposals && proposals.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">{proposals.length}</span>
          )}
        </h2>
        {proposals === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : proposals.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing waiting. Mail that needs no reply is handled silently and never shown.
          </p>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} onSend={send} onDismiss={dismiss} />
            ))}
          </div>
        )}
      </section>

      {/* 2. What the assistant is doing */}
      <AgentActivity token={token} onOpen={onOpenAgents} />

      {/* 3. What actually got done */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Done today
        </h2>
        {done === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : doneItems.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing completed yet today.</p>
        ) : (
          <div className="space-y-3">
            {doneItems.map((item: any) => (
              <div key={item.id} className="bg-surface border border-slate-700 rounded-xl p-4">
                <p className="text-sm font-semibold text-slate-100">{item.project || item.title}</p>
                {item.narrative && (
                  <p className="text-sm text-slate-400 mt-1 leading-relaxed">{item.narrative}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
