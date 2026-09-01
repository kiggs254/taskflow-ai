import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Copy, Image as ImageIcon,
  Loader2, Send, Square, Terminal, Volume2, X, Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../services/apiService';
import { LANE_LABEL, type Lane } from '../services/agentStream';
import { useAgentConsole, type Approval, type ToolCall, type Turn } from './agentConsole/useAgentConsole';

/**
 * Live agent console.
 *
 * Owns all of its own state deliberately: App.tsx is a 3,800-line monolith with
 * no state library, and a token stream must never re-render it.
 */

// Whole literal class names only — Tailwind scans source text, so an
// interpolated fragment compiles to nothing.
const LANE_STYLE: Record<Lane, { border: string; text: string; dot: string }> = {
  claude: { border: 'border-primary/50', text: 'text-primary', dot: 'bg-primary' },
  // purple, not violet: index.css only reclaims text-white on a fixed list of
  // fills, and bg-violet-* is not on it.
  hermes: { border: 'border-purple-500/50', text: 'text-purple-400', dot: 'bg-purple-500' },
  codex: { border: 'border-emerald-500/50', text: 'text-emerald-400', dot: 'bg-emerald-500' },
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
    <code className="bg-slate-900 text-amber-300 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
  ),
  pre: ({ children }: any) => (
    <pre className="bg-slate-900 border border-slate-700 rounded-lg p-3 overflow-x-auto text-xs font-mono mb-2">
      {children}
    </pre>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-slate-600 pl-3 text-slate-400 italic mb-2">{children}</blockquote>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{children}</a>
  ),
};

const secs = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Ticks once a second so elapsed timers move. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const ToolCallRow: React.FC<{ call: ToolCall; now: number }> = ({ call, now }) => {
  const [open, setOpen] = useState(false);
  const running = call.result === undefined;
  const elapsed = running ? now - call.startedTs : (call.resultTs || call.startedTs) - call.startedTs;
  const style = LANE_STYLE[call.lane];

  return (
    <div className={`border-l-2 ${style.border} pl-3 py-1`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left group"
      >
        <ChevronRight className={`w-3 h-3 text-slate-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`text-xs font-semibold shrink-0 ${style.text}`}>{call.tool}</span>
        {call.lane !== 'claude' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${style.text} bg-slate-800 shrink-0`}>
            {LANE_LABEL[call.lane]}
          </span>
        )}
        <span className="text-xs text-slate-500 font-mono truncate flex-1" title={call.detail}>
          {call.detail}
        </span>
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" /> {secs(elapsed)}
          </span>
        ) : (
          <span className="text-xs text-slate-600 shrink-0">{secs(elapsed)}</span>
        )}
        {call.failure === 'certain' && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
        {call.failure === 'suspected' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <pre className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 overflow-x-auto text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
            {call.detail}
          </pre>
          {call.result !== undefined && (
            <div>
              <pre className={`rounded-lg p-2.5 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap border ${
                call.failure === 'certain'
                  ? 'bg-red-500/10 border-red-500/30 text-red-200'
                  : call.failure === 'suspected'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}>
                {call.result || '(no output)'}
              </pre>
              {call.truncated && (
                <p className="text-[10px] text-slate-500 mt-1">
                  The agent truncates tool output at 300 characters. This may not be the whole result.
                </p>
              )}
              {call.failure === 'suspected' && (
                <p className="text-[10px] text-amber-400/80 mt-1">
                  Looks like a failure. The protocol carries no exit code, so this is inferred from the text.
                </p>
              )}
            </div>
          )}
          {call.media && (
            <div className="text-[11px] text-slate-400 bg-slate-800/50 border border-slate-700/60 rounded-lg p-2.5">
              <span className="font-mono break-all">{call.media.path}</span>
              {!call.media.fetchable && (
                <p className="mt-1 text-slate-500">
                  Generated inside the Hermes container, so there is no local copy to show. Ask the agent to
                  re-run it with <code className="text-amber-300">--out /work/…</code> to get one.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const OUTCOME: Record<Turn['outcome'], { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'text-blue-400' },
  ok: { label: 'Done', cls: 'text-emerald-400' },
  stopped: { label: 'Stopped', cls: 'text-amber-400' },
  error: { label: 'Failed', cls: 'text-red-400' },
  unknown: { label: 'Ended without a result', cls: 'text-slate-400' },
};

const TurnBlock: React.FC<{ turn: Turn; now: number; onRetry: (text: string) => void }> = ({ turn, now, onRetry }) => {
  const elapsed = (turn.endedTs || now) - turn.startedTs;
  const body = turn.assistant || turn.streaming;

  return (
    <div className="bg-surface border border-slate-700 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Turn {turn.taskId}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500 capitalize">{turn.source}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">{secs(elapsed)}</span>
        <span className={`ml-auto font-medium ${OUTCOME[turn.outcome].cls}`}>
          {turn.outcome === 'running' && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
          {OUTCOME[turn.outcome].label}
        </span>
      </div>

      <div className="flex justify-end">
        <div className="bg-primary/15 border border-primary/20 rounded-lg px-3 py-2 max-w-[85%]">
          <p className="text-sm text-slate-100 whitespace-pre-wrap">{turn.userText}</p>
        </div>
      </div>

      {turn.tools.length > 0 && (
        <div className="space-y-0.5">
          {turn.tools.map((c) => <ToolCallRow key={c.key} call={c} now={now} />)}
        </div>
      )}

      {body && (
        <div className="text-sm">
          {turn.assistant ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{turn.assistant}</ReactMarkdown>
          ) : (
            <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">
              {turn.streaming}
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary/70 animate-pulse align-text-bottom" />
            </p>
          )}
        </div>
      )}

      {turn.outcome === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
            <AlertTriangle className="w-4 h-4" /> This turn failed
          </div>
          <pre className="text-[11px] font-mono text-red-200 whitespace-pre-wrap">{turn.outcomeText || 'No detail'}</pre>
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
              Retry this turn
            </button>
          </div>
        </div>
      )}

      {turn.outcome === 'unknown' && (
        <p className="text-xs text-slate-500 border-t border-slate-700/60 pt-2">{turn.outcomeText}</p>
      )}
    </div>
  );
};

const ApprovalCard: React.FC<{ a: Approval; now: number; onDecide: (id: string, d: 'approve' | 'deny') => void; busy: boolean }> =
  ({ a, now, onDecide, busy }) => {
    const left = a.expiresAt - now;
    const style = LANE_STYLE[a.lane];
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className={`text-xs font-semibold ${style.text}`}>{a.tool}</span>
          <span className="ml-auto text-[11px] text-amber-300">
            {left > 0 ? `${secs(left)} left` : 'expired'}
          </span>
        </div>
        <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
          {a.detail}
        </pre>
        <div className="flex gap-2">
          <button
            disabled={busy || left <= 0}
            onClick={() => onDecide(a.approvalId, 'approve')}
            className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-1.5"
          >
            <Check className="w-3 h-3" /> Approve
          </button>
          <button
            disabled={busy || left <= 0}
            onClick={() => onDecide(a.approvalId, 'deny')}
            className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="w-3 h-3" /> Deny
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
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const now = useNow(true);

  const running = c.turns.some((t) => t.outcome === 'running') || Boolean(c.status?.busy);

  // Follow the tail only while the user is already at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [c.turns, now]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setActionError('');
    try {
      await api.console.send(token, body);
      setDraft('');
      stickToBottom.current = true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [token, sending]);

  const stop = useCallback(async () => {
    setActionError('');
    try {
      await api.console.stop(token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop');
    }
  }, [token]);

  const decide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setActionError('');
    try {
      await api.console.approve(token, id, decision);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record the decision');
    }
  }, [token]);

  // Own the shortcuts while mounted, in the capture phase, so App's global
  // ⌘K/Escape handler does not also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (running) void stop();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') e.stopImmediatePropagation();
      if (e.key === 'Escape') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, stop]);

  const hermesBusy = useMemo(
    () => c.turns.flatMap((t) => t.tools).find((x) => x.lane === 'hermes' && x.result === undefined),
    [c.turns]
  );

  const relayDot =
    c.relay === 'up' ? 'bg-emerald-500 animate-pulse'
      : c.relay === 'down' ? 'bg-red-500'
        : 'bg-amber-500 animate-pulse';

  if (c.configured === false) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2">
            <ArrowLeft className="w-5 h-5" /> Back
          </button>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-200 text-sm">
            The agent console is not configured on the server. Set <code className="font-mono">AGENT_URL</code>,{' '}
            <code className="font-mono">AGENT_CONTROL_TOKEN</code> and <code className="font-mono">CONSOLE_USER_IDS</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      {/* Header — always visible */}
      <header className="h-14 shrink-0 border-b border-slate-700 bg-surface flex items-center gap-3 px-4">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Terminal className="w-4 h-4 text-primary" />
        <h1 className="text-sm font-bold text-white">Agent Console</h1>

        <div className="flex items-center gap-1.5 ml-2" title={`Relay: ${c.relay}${c.relayMessage ? ` — ${c.relayMessage}` : ''}`}>
          <div className={`w-2 h-2 rounded-full ${relayDot}`} />
          <span className="text-xs text-slate-400">Claude · kiggs-agent</span>
        </div>

        <div
          className="hidden sm:flex items-center gap-1.5"
          title="Hermes is reached only through Claude's gpt CLI. This reflects what Claude has asked it to do; TaskFlow has no direct connection to Hermes."
        >
          <div className={`w-2 h-2 rounded-full ${hermesBusy ? 'bg-purple-500 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-xs text-slate-400">
            Hermes · {hermesBusy ? `${secs(now - hermesBusy.startedTs)}` : 'via Claude'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {c.status && (
            <span className="hidden md:inline text-xs text-slate-500" title="Scope the agent is working in">
              {c.status.scopeLabel}
            </span>
          )}
          {c.status && c.status.queueLength > 0 && (
            <span
              className="text-xs text-amber-400"
              title="The agent has no route to inspect or cancel its own queue."
            >
              {c.status.queueLength} queued
            </span>
          )}
          <button
            onClick={stop}
            disabled={!running}
            title="Stop the current turn (⌘.)"
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-30 disabled:hover:bg-red-600 transition-colors flex items-center gap-1.5"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
        </div>
      </header>

      {/* Relay failure is a banner, never silence */}
      {(c.relay === 'down' || c.relay === 'reconnecting') && (
        <div className={`shrink-0 px-4 py-2.5 text-sm flex items-center gap-2 ${
          c.relay === 'down'
            ? 'bg-red-500/10 border-b border-red-500/30 text-red-300'
            : 'bg-amber-500/10 border-b border-amber-500/30 text-amber-200'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {c.relay === 'down' ? 'Agent unreachable' : 'Reconnecting to the agent'}
          {c.relayMessage && <span className="text-xs opacity-80">— {c.relayMessage}</span>}
        </div>
      )}
      {c.loadError && (
        <div className="shrink-0 px-4 py-2.5 bg-red-500/10 border-b border-red-500/30 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {c.loadError}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Transcript */}
        <main ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          {!c.booted && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading transcript…
            </div>
          )}
          {c.booted && c.turns.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-12">
              Nothing yet. Send the agent something below.
            </div>
          )}
          {c.turns.map((t) => <TurnBlock key={t.taskId} turn={t} now={now} onRetry={send} />)}
        </main>

        {/* Right rail */}
        <aside className="hidden xl:flex w-80 shrink-0 border-l border-slate-700 bg-surface/40 flex-col overflow-y-auto">
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Approvals {c.liveApprovals.length > 0 && `(${c.liveApprovals.length})`}
              </h2>
              {c.liveApprovals.length === 0 ? (
                <p className="text-xs text-slate-600">Nothing waiting.</p>
              ) : (
                <div className="space-y-2">
                  {c.liveApprovals.map((a) => (
                    <ApprovalCard key={a.approvalId} a={a} now={now} onDecide={decide} busy={false} />
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Errors {c.errors.length > 0 && `(${c.errors.length})`}
              </h2>
              {c.errors.length === 0 ? (
                <p className="text-xs text-slate-600">None.</p>
              ) : (
                <div className="space-y-1.5">
                  {c.errors.slice(-8).reverse().map((e, i) => (
                    <div key={i} className="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2 break-all">
                      {e.text.slice(0, 160)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Ask Hermes</h2>
              <p className="text-[11px] text-slate-500 mb-2">
                Writes an instruction to Claude, which shells out to Hermes. That is the only path there is.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDraft('Run: gpt image "" --aspect square --out /work/uploads/out.png — then Read the file and tell me whether it matches.')}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ImageIcon className="w-3 h-3" /> Image
                </button>
                <button
                  onClick={() => setDraft('Run: gpt tts "" --out /work/uploads/out.mp3')}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Volume2 className="w-3 h-3" /> Speech
                </button>
              </div>
              <p className="text-[10px] text-slate-600 mt-2">
                <Zap className="w-2.5 h-2.5 inline" /> <span className="text-emerald-400">gpt ask</span> and{' '}
                <span className="text-emerald-400">gpt review</span> run GPT-5 inside the agent container, not Hermes.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* Approvals must not be missable when the rail is hidden */}
      {c.liveApprovals.length > 0 && (
        <div className="xl:hidden shrink-0 border-t border-amber-500/30 bg-amber-500/10 p-3 space-y-2 max-h-64 overflow-y-auto">
          {c.liveApprovals.map((a) => (
            <ApprovalCard key={a.approvalId} a={a} now={now} onDecide={decide} busy={false} />
          ))}
        </div>
      )}

      {/* Composer */}
      <footer className="shrink-0 border-t border-slate-700 bg-surface p-3">
        {actionError && (
          <div className="mb-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {actionError}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder={running ? 'Agent is working — your message will queue…' : 'Message the agent…  Enter to send, Shift+Enter for a newline'}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary resize-none"
          />
          <button
            onClick={() => void send(draft)}
            disabled={!draft.trim() || sending}
            className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
          </button>
        </div>
      </footer>
    </div>
  );
};

export default AgentConsole;
