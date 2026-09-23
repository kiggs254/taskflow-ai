import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../services/apiService';
import { EmailProposal, Task } from '../types';
import { LogWorkModal } from './LogWorkModal';
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
  const [logging, setLogging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

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

  /**
   * Record work the scanners can't see.
   *
   * Reloads rather than pushing the task into local state: the panel renders `project`
   * and `narrative`, which the server derives from the title. Faking them here would
   * show something subtly different from what the report will actually post.
   */
  /** Run the real scan on demand, and say plainly what came back. */
  const checkMailNow = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const r = await api.gmail.scanNow(token);
      if (r?.ok === false) {
        setCheckResult(
          r.needsReconnect
            ? `${r.error} — reconnect Gmail in Settings.`
            : String(r.error || 'The scan failed.')
        );
      } else {
        const n = r?.proposalsCreated ?? 0;
        setCheckResult(
          n > 0
            ? `Found ${n} email${n === 1 ? '' : 's'} needing a reply.`
            : `Checked. ${r?.ignored ?? 0} needed no reply, ${r?.skipped ?? 0} already seen.`
        );
      }
      await load();
    } catch (e: any) {
      setCheckResult(e?.message || 'The scan failed.');
    } finally {
      setChecking(false);
    }
  }, [token, load]);

  const logWork = useCallback(async (task: Task) => {
    await api.syncTask(token, task);
    await load();
  }, [token, load]);

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
          mailbox.stalled && mailbox.connected !== false && mailbox.enabled !== false ? (
            /* A stalled scanner used to be indistinguishable from a quiet inbox: the line
               read "last checked 23:55:02" all the following day, beside "Nothing
               waiting", and looked calm. It is the opposite of calm. */
            <div className="mb-3 flex gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Mail is not being read.</strong>{' '}
                {mailbox.lastScanAt
                  ? `The last successful check of ${mailbox.email} was ${new Date(mailbox.lastScanAt).toLocaleString()}.`
                  : `${mailbox.email} has never been checked successfully.`}
                {mailbox.consecutiveFailures > 0 &&
                  ` ${mailbox.consecutiveFailures} attempt${mailbox.consecutiveFailures === 1 ? '' : 's'} have failed since.`}
                {mailbox.lastError && (
                  <> Last error: <span className="text-amber-200">{mailbox.lastError}</span></>
                )}
                <button
                  onClick={checkMailNow}
                  disabled={checking}
                  className="block mt-2 font-semibold text-amber-200 hover:text-white transition-colors disabled:opacity-50"
                >
                  {checking ? 'Checking…' : 'Check now'}
                </button>
                {checkResult && <span className="block mt-1 text-amber-200/90">{checkResult}</span>}
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 mb-3">
              {mailbox.connected === false || !mailbox.email
                ? 'Gmail is not connected — nothing is being read.'
                : mailbox.enabled === false
                  ? `Scanning is turned off for ${mailbox.email}.`
                  : `Checking the Primary tab of ${mailbox.email} every ${mailbox.scanFrequency ?? 15} min` +
                    (mailbox.lastScanAt
                      ? ` · last checked ${new Date(mailbox.lastScanAt).toLocaleTimeString()}`
                      : ' · not run yet')}
            </p>
          )
        )}

        {proposals === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : proposalError ? (
          <p className="flex items-start gap-2 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {proposalError}
          </p>
        ) : proposals.length === 0 ? (
          /* Only an empty queue the scanner actually produced means "nothing waiting".
             With a stalled scanner the banner above already says why, and repeating the
             reassurance here would contradict it. */
          <p className="text-xs text-slate-500">
            {mailbox?.stalled
              ? 'Nothing to show — the last scan did not complete, so this list is out of date.'
              : 'Nothing waiting. Mail that needs no reply is handled silently and never shown.'}
          </p>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} token={token} onSend={send} onDismiss={dismiss} />
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

        {/* Always offered, including when the list is empty -- a quiet day is exactly
            when work done off-screen is the only thing there is to report. */}
        <button
          onClick={() => setLogging(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Log work done elsewhere
        </button>
      </section>

      <LogWorkModal isOpen={logging} onClose={() => setLogging(false)} onSave={logWork} />
    </div>
  );
};
