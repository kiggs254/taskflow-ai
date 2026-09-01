import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Image as ImageIcon,
  Loader2, Send, Square, Terminal, Volume2, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../services/apiService';
import { describeCall, type Lane } from '../services/agentStream';
import { useAgentConsole, type Approval, type ToolCall, type Turn } from './agentConsole/useAgentConsole';

/**
 * Live agent console.
 *
 * Sits inside the normal app shell like Analytics and the KPI report, so it is
 * a narrow single column. Two consequences drive the layout: no side rails, and
 * the transcript must stay skimmable rather than dumping every shell command.
 *
 * Old turns collapse to one line. Steps are described in plain language
 * ("Searched for “price”") with the exact command one click away — the raw log
 * is still there, it just isn't the default reading experience.
 *
 * Owns all of its own state: App.tsx has no state library and a token stream
 * must never re-render it.
 */

// Whole literal class names only — Tailwind scans source text.
const LANE_DOT: Record<Lane, string> = {
  claude: 'bg-slate-500',
  hermes: 'bg-purple-400',
  codex: 'bg-emerald-400',
};

const MD = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0 text-slate-200 leading-relaxed">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 mb-2 space-y-1 text-slate-200">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-2 space-y-1 text-slate-200">{children}</ol>,
  li: ({ children }: any) => <li className="text-slate-200">{children}</li>,
  h1: ({ children }: any) => <h1 className="text-base font-bold text-white mt-3 mb-1.5">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-sm font-bold text-white mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h3>,
  code: ({ children }: any) => (
    <code className="bg-slate-900 text-amber-300 px-1.5 py-0.5 rounded text-xs font-mono break-words">{children}</code>
  ),
  pre: ({ children }: any) => (
    <pre className="bg-slate-900 border border-slate-700 rounded-lg p-3 overflow-x-auto text-xs font-mono mb-2">{children}</pre>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-slate-600 pl-3 text-slate-400 italic mb-2">{children}</blockquote>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline break-words">{children}</a>
  ),
};

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** One step, in words. The raw command is revealed by the parent's toggle. */
const StepRow: React.FC<{ call: ToolCall; now: number; raw: boolean }> = ({ call, now, raw }) => {
  const running = call.result === undefined;
  const elapsed = running ? now - call.startedTs : (call.resultTs || call.startedTs) - call.startedTs;
  const slow = elapsed > 4000;

  return (
    <div className="py-1">
      <div className="flex items-start gap-2">
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${LANE_DOT[call.lane]}`} />
        <span className="text-sm text-slate-300 flex-1 min-w-0 break-words">
          {describeCall(call.tool, call.detail)}
          {call.lane === 'hermes' && <span className="ml-1.5 text-[10px] text-purple-400">Hermes</span>}
          {call.lane === 'codex' && <span className="ml-1.5 text-[10px] text-emerald-400">GPT-5</span>}
        </span>
        {running ? (
          <span className="flex items-center gap-1 text-xs text-blue-400 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" />{dur(elapsed)}
          </span>
        ) : (
          slow && <span className="text-xs text-slate-600 shrink-0">{dur(elapsed)}</span>
        )}
        {call.failure === 'certain' && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
        {call.failure === 'suspected' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
      </div>

      {raw && (
        <div className="ml-3.5 mt-1 space-y-1">
          <pre className="bg-slate-900 border border-slate-700 rounded p-2 overflow-x-auto text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all">
            {call.detail}
          </pre>
          {call.result !== undefined && call.result !== '' && (
            <pre className={`rounded p-2 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap break-all border ${
              call.failure === 'certain' ? 'bg-red-500/10 border-red-500/30 text-red-200'
                : call.failure === 'suspected' ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
                  : 'bg-slate-900 border-slate-700 text-slate-500'
            }`}>
              {call.result}
              {call.truncated && '\n\n(the agent truncates tool output at 300 characters)'}
            </pre>
          )}
        </div>
      )}

      {!raw && call.failure && call.result && (
        <p className={`ml-3.5 mt-0.5 text-xs break-words ${call.failure === 'certain' ? 'text-red-300' : 'text-amber-300'}`}>
          {call.result.slice(0, 200)}
        </p>
      )}
    </div>
  );
};

const OUTCOME: Record<Turn['outcome'], { dot: string; label: string }> = {
  running: { dot: 'bg-blue-400 animate-pulse', label: 'working' },
  ok:      { dot: 'bg-emerald-500',            label: 'done' },
  stopped: { dot: 'bg-amber-500',              label: 'stopped' },
  error:   { dot: 'bg-red-500',                label: 'failed' },
  unknown: { dot: 'bg-slate-500',              label: 'ended' },
};

const TurnBlock: React.FC<{
  turn: Turn; now: number; defaultOpen: boolean; onRetry: (t: string) => void;
}> = ({ turn, now, defaultOpen, onRetry }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState(false);
  // A turn that starts running after mount should open itself.
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);

  const elapsed = (turn.endedTs || now) - turn.startedTs;
  const o = OUTCOME[turn.outcome];
  const failed = turn.outcome === 'error';
  const running = turn.outcome === 'running';

  return (
    <div className={`rounded-xl border ${failed ? 'border-red-500/40 bg-red-500/5' : 'border-slate-700 bg-surface'}`}>
      {/* Collapsed header: the ask, the outcome, how long it took. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 p-3.5 text-left hover:bg-slate-800/40 transition-colors rounded-xl"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />}
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${o.dot}`} />
        <span className="flex-1 min-w-0">
          <span className={`block text-sm break-words ${open ? 'text-white font-medium' : 'text-slate-300 line-clamp-2'}`}>
            {turn.userText || '(no prompt)'}
          </span>
          <span className="block text-xs text-slate-500 mt-0.5">
            {turn.source === 'telegram' ? 'from Telegram' : 'from here'}
            {' · '}{o.label}
            {' · '}{dur(elapsed)}
            {turn.tools.length > 0 && ` · ${turn.tools.length} step${turn.tools.length === 1 ? '' : 's'}`}
          </span>
        </span>
        {running && <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0 mt-0.5" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {turn.tools.length > 0 && (
            <div className="border-t border-slate-700/60 pt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider text-slate-500">What it did</span>
                <button
                  onClick={() => setRaw((v) => !v)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {raw ? 'hide commands' : 'show commands'}
                </button>
              </div>
              <div className="divide-y divide-slate-800">
                {turn.tools.map((call) => <StepRow key={call.key} call={call} now={now} raw={raw} />)}
              </div>
            </div>
          )}

          {(turn.assistant || turn.streaming) && (
            <div className="border-t border-slate-700/60 pt-3 text-sm">
              {turn.assistant ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{turn.assistant}</ReactMarkdown>
              ) : (
                <p className="text-slate-200 whitespace-pre-wrap leading-relaxed break-words">
                  {turn.streaming}
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary/70 animate-pulse align-text-bottom" />
                </p>
              )}
            </div>
          )}

          {failed && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
                <AlertTriangle className="w-4 h-4" /> It failed
              </div>
              <pre className="text-[11px] font-mono text-red-200 whitespace-pre-wrap break-all">
                {turn.outcomeText || 'No detail was reported.'}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard?.writeText(turn.outcomeText || '')}
                  className="text-xs px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button
                  onClick={() => onRetry(turn.userText)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-primary text-white hover:opacity-90 transition-opacity"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {turn.outcome === 'unknown' && (
            <p className="text-xs text-slate-500 border-t border-slate-700/60 pt-2">{turn.outcomeText}</p>
          )}
        </div>
      )}
    </div>
  );
};

const ApprovalCard: React.FC<{ a: Approval; now: number; onDecide: (id: string, d: 'approve' | 'deny') => void }> =
  ({ a, now, onDecide }) => {
    const left = a.expiresAt - now;
    return (
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-amber-200">Waiting for your OK</span>
          <span className="ml-auto text-xs text-amber-300">{left > 0 ? `${dur(left)} left` : 'expired'}</span>
        </div>
        <p className="text-sm text-slate-200">{describeCall(a.tool, a.detail)}</p>
        <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all max-h-28 overflow-y-auto bg-slate-900 rounded p-2">
          {a.detail}
        </pre>
        <div className="flex gap-2">
          <button
            disabled={left <= 0}
            onClick={() => onDecide(a.approvalId, 'approve')}
            className="flex-1 text-sm px-3 py-2 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" /> Approve
          </button>
          <button
            disabled={left <= 0}
            onClick={() => onDecide(a.approvalId, 'deny')}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" /> No
          </button>
        </div>
      </div>
    );
  };

interface Props {
  token: string;
  onBack: () => void;
}

export const AgentConsole: React.FC<Props> = ({ token, onBack }) => {
  const c = useAgentConsole(token);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [hermes, setHermes] = useState<{ state: string; reason?: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const running = c.turns.some((t) => t.outcome === 'running') || Boolean(c.status?.busy);

  // Ask whether Hermes is actually up, rather than inferring it from whether a
  // Hermes call happens to be in flight — idle is not the same as offline.
  useEffect(() => {
    let dead = false;
    const check = async () => {
      try {
        const r = await api.console.hermes(token);
        if (!dead) setHermes(r);
      } catch {
        if (!dead) setHermes({ state: 'unknown' });
      }
    };
    void check();
    const t = setInterval(check, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [token]);

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setActionError('');
    try {
      await api.console.send(token, body);
      setDraft('');
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 120);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  }, [token, sending]);

  const stop = useCallback(async () => {
    setActionError('');
    try { await api.console.stop(token); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Could not stop it'); }
  }, [token]);

  const decide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setActionError('');
    try { await api.console.approve(token, id, decision); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Could not record that'); }
  }, [token]);

  // Own ⌘. while mounted; leave App's ⌘K and Escape alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (running) void stop();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, stop]);

  const lastId = c.turns.length ? c.turns[c.turns.length - 1].taskId : null;
  const hermesUp = hermes?.state === 'up';
  const hermesLabel =
    hermes === null ? 'checking…'
      : hermes.state === 'up' ? 'ready'
        : hermes.state === 'unconfigured' ? 'not set up'
          : 'offline';

  if (c.configured === false) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-200 text-sm">
          The agent console is not switched on for this server yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Terminal className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold text-white">Agent</h1>
        <button
          onClick={stop}
          disabled={!running}
          title="Stop what it's doing (⌘.)"
          className="ml-auto px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-25 disabled:hover:bg-red-600 transition-colors flex items-center gap-1.5"
        >
          <Square className="w-3 h-3" /> Stop
        </button>
      </div>

      <div className="bg-surface border border-slate-700 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            c.relay === 'up' ? (running ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500')
              : c.relay === 'down' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'
          }`} />
          <span className="text-slate-300">
            Claude <span className="text-slate-500">{c.relay !== 'up' ? c.relay : running ? 'working' : 'idle'}</span>
          </span>
        </span>
        <span className="flex items-center gap-2" title={hermes?.reason ? `capability service: ${hermes.reason}` : 'Hermes makes images and speech'}>
          <span className={`w-2 h-2 rounded-full ${hermesUp ? 'bg-emerald-500' : hermes === null ? 'bg-slate-600' : 'bg-red-500'}`} />
          <span className="text-slate-300">Hermes <span className="text-slate-500">{hermesLabel}</span></span>
        </span>
        {c.status?.scopeLabel && <span className="text-slate-500 text-xs">{c.status.scopeLabel}</span>}
        {Boolean(c.status?.queueLength) && (
          <span className="text-amber-400 text-xs">{c.status!.queueLength} waiting</span>
        )}
      </div>

      {(c.relay === 'down' || c.relay === 'reconnecting') && (
        <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
          c.relay === 'down' ? 'bg-red-500/10 border border-red-500/30 text-red-300'
            : 'bg-amber-500/10 border border-amber-500/30 text-amber-200'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {c.relay === 'down' ? "Can't reach the agent right now." : 'Reconnecting…'}
            {c.relayMessage && <span className="opacity-70"> {c.relayMessage}</span>}
          </span>
        </div>
      )}
      {c.loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {c.loadError}
        </div>
      )}

      {/* Approvals sit above everything: they block progress. */}
      {c.liveApprovals.map((a) => (
        <ApprovalCard key={a.approvalId} a={a} now={now} onDecide={decide} />
      ))}

      {!c.booted && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {c.booted && c.turns.length === 0 && (
        <p className="text-center text-slate-500 text-sm py-10">Nothing yet. Ask it for something below.</p>
      )}

      <div className="space-y-2">
        {c.turns.map((t) => (
          <TurnBlock
            key={t.taskId}
            turn={t}
            now={now}
            defaultOpen={t.taskId === lastId || t.outcome === 'running' || t.outcome === 'error'}
            onRetry={send}
          />
        ))}
      </div>
      <div ref={endRef} />

      <div className="sticky bottom-0 bg-background pt-2 pb-1">
        {actionError && (
          <div className="mb-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {actionError}
          </div>
        )}
        <div className="bg-surface border border-slate-700 rounded-xl p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
            }}
            rows={2}
            placeholder={running ? "It's working — this will queue" : 'Ask the agent for something…'}
            className="w-full bg-transparent px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none resize-none"
          />
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={() => setDraft('Generate an image of ')}
              title="Hermes makes the image; Claude runs it"
              className="text-xs px-2 py-1 rounded-lg text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center gap-1"
            >
              <ImageIcon className="w-3 h-3" /> Image
            </button>
            <button
              onClick={() => setDraft('Say this out loud: ')}
              className="text-xs px-2 py-1 rounded-lg text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center gap-1"
            >
              <Volume2 className="w-3 h-3" /> Speech
            </button>
            <button
              onClick={() => void send(draft)}
              disabled={!draft.trim() || sending}
              className="ml-auto px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentConsole;
