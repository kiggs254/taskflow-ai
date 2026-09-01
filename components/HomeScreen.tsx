import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../services/apiService';
import { EmailProposal } from '../types';
import { ProposalCard } from './ProposalCard';

/**
 * The assistant's home.
 *
 * Three things, in the order they matter: what wants a decision from you, what the
 * assistant is doing right now, and what actually got done today. Deliberately not a
 * backlog — the app stopped being a to-do list.
 */

export const HomeScreen: React.FC<{ token: string }> = ({ token }) => {
  const [proposals, setProposals] = useState<EmailProposal[] | null>(null);
  const [done, setDone] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A failed load used to leave `proposals` null forever, which rendered as a permanent
  // "Loading…" -- indistinguishable from a slow request and impossible to diagnose.
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [doneError, setDoneError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<any>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [p, d, g] = await Promise.allSettled([
        api.proposals.list(token),
        api.reports.completedToday(token, 'day'),
        api.gmail.status(token),
      ]);
      if (g.status === 'fulfilled') setMailbox(g.value);
      // One failing must not blank the other -- allSettled, not all.
      if (p.status === 'fulfilled') {
        setProposals(p.value.proposals || []);
        setProposalError(null);
      } else {
        setProposals([]);
        setProposalError(p.reason?.message || 'Could not load proposals');
      }
      if (d.status === 'fulfilled') {
        setDone(d.value);
        setDoneError(null);
      } else {
        setDone({ items: [] });
        setDoneError(d.reason?.message || 'Could not load today\'s work');
      }
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

      {/* What wants you */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-3">
          <Inbox className="w-4 h-4 text-primary" />
          Needs your reply
          {proposals && proposals.length > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">{proposals.length}</span>
          )}
        </h2>
        {/* Who is actually reading the mail. The triage runs on a schedule in the
            backend, not in the agent console, so without this line an idle agent looks
            like nothing is happening. */}
        {mailbox && (
          <p className="text-[11px] text-slate-500 mb-3">
            {mailbox.connected === false || !mailbox.email
              ? 'Gmail is not connected — nothing is being read.'
              : mailbox.enabled === false
                ? `Scanning is turned off for ${mailbox.email}.`
                : `Checking ${mailbox.email} every ${mailbox.scanFrequency ?? 15} min` +
                  (mailbox.lastScanAt
                    ? ` · last checked ${new Date(mailbox.lastScanAt).toLocaleTimeString()}`
                    : ' · not run yet')}
          </p>
        )}

        {proposals === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : proposalError ? (
          <p className="flex items-start gap-2 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {proposalError}
          </p>
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


      {/* What actually got done */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Done today
        </h2>
        {done === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : doneError ? (
          <p className="flex items-start gap-2 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {doneError}
          </p>
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
