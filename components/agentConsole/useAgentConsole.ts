import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/apiService';
import {
  connectAgentStream,
  detectFailure,
  detectMedia,
  laneFor,
  type Lane,
  type RawAgentEvent,
} from '../../services/agentStream';

/**
 * Folds the agent's raw event stream into turns the console can render.
 *
 * Three properties of the wire protocol shape everything here, and each one is a
 * way the UI could quietly lie if ignored:
 *
 *  1. **No `result` follows an `error`.** Keying "finished" off `result` alone
 *     leaves an errored turn spinning forever.
 *  2. **`assistant` replaces the token buffer, it does not append.** Appending
 *     renders the reply twice.
 *  3. **Tool results carry no id, no tool name and no exit code.** Pairing is
 *     positional and therefore best-effort, and failure is inferred. Both are
 *     labelled as such rather than presented as fact.
 */

export interface ToolCall {
  key: string;
  id?: number;
  tool: string;
  detail: string;
  lane: Lane;
  startedTs: number;
  result?: string;
  resultTs?: number;
  failure: 'certain' | 'suspected' | null;
  media: { path: string; kind: 'image' | 'audio'; fetchable: boolean } | null;
  truncated: boolean;
}

export interface Turn {
  taskId: string;
  source: string;
  userText: string;
  startedTs: number;
  streaming: string;
  assistant: string;
  tools: ToolCall[];
  outcome: 'running' | 'ok' | 'stopped' | 'error' | 'unknown';
  outcomeText: string;
  endedTs?: number;
}

export interface Approval {
  approvalId: string;
  tool: string;
  detail: string;
  lane: Lane;
  ts: number;
  expiresAt: number;
  stale: boolean;
}

export interface AgentStatus {
  busy: boolean;
  scope: string;
  scopeLabel: string;
  queueLength: number;
  activeTaskId: string | null;
  hasSession: boolean;
}

export type RelayState = 'connecting' | 'up' | 'reconnecting' | 'down';

const TOOL_RESULT_CAP = 300; // the agent truncates here; say so rather than imply completeness

export function useAgentConsole(token: string) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [relay, setRelay] = useState<RelayState>('connecting');
  const [relayMessage, setRelayMessage] = useState<string>('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string>('');
  const [booted, setBooted] = useState(false);

  const seenIds = useRef<Set<number>>(new Set());
  const lastId = useRef<number>(0);
  // Token deltas arrive fast. Buffer them and flush on a frame so a chatty turn
  // re-renders this component at screen rate, never per token.
  const pending = useRef<Map<string, string>>(new Map());
  const raf = useRef<number | null>(null);

  const flush = useCallback(() => {
    raf.current = null;
    if (pending.current.size === 0) return;
    const batch = new Map(pending.current);
    pending.current.clear();
    setTurns((prev) =>
      prev.map((t) => (batch.has(t.taskId) ? { ...t, streaming: t.streaming + batch.get(t.taskId)! } : t))
    );
  }, []);

  const scheduleFlush = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(flush);
  }, [flush]);

  const apply = useCallback((e: RawAgentEvent) => {
    if (typeof e.id === 'number') {
      if (seenIds.current.has(e.id)) return; // replay after reconnect
      seenIds.current.add(e.id);
      if (e.id > lastId.current) lastId.current = e.id;
    }

    const ts = (e.ts || 0) * 1000;
    const taskId = e.taskId || '';

    switch (e.kind) {
      case 'status':
        setStatus({
          busy: Boolean(e.busy),
          scope: String(e.scope || ''),
          scopeLabel: String(e.scopeLabel || ''),
          queueLength: Number(e.queueLength || 0),
          activeTaskId: (e.activeTaskId as string | null) ?? null,
          hasSession: Boolean(e.hasSession),
        });
        return;

      case 'user':
        setTurns((prev) => {
          if (prev.some((t) => t.taskId === taskId)) return prev;
          return [
            ...prev,
            {
              taskId,
              source: String(e.source || 'web'),
              userText: String(e.text || ''),
              startedTs: ts,
              streaming: '',
              assistant: '',
              tools: [],
              outcome: 'running',
              outcomeText: '',
            },
          ];
        });
        return;

      case 'token':
        pending.current.set(taskId, (pending.current.get(taskId) || '') + String(e.text || ''));
        scheduleFlush();
        return;

      case 'assistant':
        // Replaces the streamed buffer. Appending would double-render the reply.
        setTurns((prev) =>
          prev.map((t) => (t.taskId === taskId ? { ...t, assistant: String(e.text || ''), streaming: '' } : t))
        );
        return;

      case 'tool': {
        const detail = String(e.detail || '');
        const call: ToolCall = {
          key: `${taskId}:${e.id ?? Math.random()}`,
          id: e.id,
          tool: String(e.tool || 'tool'),
          detail,
          lane: laneFor(String(e.tool || ''), detail),
          startedTs: ts,
          failure: null,
          media: null,
          truncated: false,
        };
        setTurns((prev) => prev.map((t) => (t.taskId === taskId ? { ...t, tools: [...t.tools, call] } : t)));
        return;
      }

      case 'tool_result': {
        const detail = String(e.detail || '');
        setTurns((prev) =>
          prev.map((t) => {
            if (t.taskId !== taskId) return t;
            // Positional pairing: results carry no tool_use_id, so the oldest
            // unanswered call wins. Exact for serial tool use, wrong under
            // parallel — an unmatched result is shown unattached rather than
            // guessed onto the wrong call.
            const idx = t.tools.findIndex((c) => c.result === undefined);
            if (idx === -1) return t;
            const tools = [...t.tools];
            tools[idx] = {
              ...tools[idx],
              result: detail,
              resultTs: ts,
              failure: detectFailure(detail),
              media: detectMedia(detail) || detectMedia(tools[idx].detail),
              truncated: detail.length >= TOOL_RESULT_CAP,
            };
            return { ...t, tools };
          })
        );
        return;
      }

      case 'approval':
        setApprovals((prev) => {
          const approvalId = String(e.approvalId || '');
          if (!approvalId || prev.some((a) => a.approvalId === approvalId)) return prev;
          const detail = String(e.detail || '');
          return [
            ...prev,
            {
              approvalId,
              tool: String(e.tool || 'tool'),
              detail,
              lane: laneFor(String(e.tool || ''), detail),
              ts,
              // The agent's own 5-minute timeout.
              expiresAt: ts + 300_000,
              // pendingApprovals is in-memory on the agent. Anything replayed
              // from the transcript older than the timeout is already dead, and
              // answering it would 404.
              stale: Date.now() - ts > 300_000,
            },
          ];
        });
        return;

      case 'approval_resolved':
        setApprovals((prev) => prev.filter((a) => a.approvalId !== String(e.approvalId || '')));
        return;

      case 'result':
      case 'stopped':
      case 'error': {
        const outcome = e.kind === 'result' ? 'ok' : e.kind === 'stopped' ? 'stopped' : 'error';
        setTurns((prev) =>
          prev.map((t) =>
            t.taskId === taskId
              ? { ...t, outcome, outcomeText: String(e.text || e.detail || ''), endedTs: ts, streaming: '' }
              : t
          )
        );
        return;
      }

      default:
        return;
    }
  }, [scheduleFlush]);

  // Bootstrap, then stream.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await api.console.bootstrap(token);
        if (cancelled) return;
        setConfigured(Boolean(boot.configured));
        if (boot.status) {
          setStatus({
            busy: Boolean(boot.status.busy),
            scope: String(boot.status.scope || ''),
            scopeLabel: String(boot.status.scopeLabel || ''),
            queueLength: Number(boot.status.queueLength || 0),
            activeTaskId: boot.status.activeTaskId ?? null,
            hasSession: Boolean(boot.status.hasSession),
          });
        }
        for (const ev of boot.transcript || []) apply(ev as RawAgentEvent);
        if (boot.agentDown) {
          setRelay('down');
          setRelayMessage(boot.reason || 'Agent unreachable');
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, apply]);

  useEffect(() => {
    if (!booted) return;
    const close = connectAgentStream(token, {
      onEvent: apply,
      onRelay: (state, message) => {
        setRelay(state);
        setRelayMessage(message || '');
      },
    });
    return () => {
      close();
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [booted, token, apply]);

  /**
   * A turn left open while the agent reports idle never received a terminal
   * event. Rather than spin forever, close it and say exactly that.
   */
  useEffect(() => {
    if (!status || status.busy || status.activeTaskId) return;
    setTurns((prev) => {
      if (!prev.some((t) => t.outcome === 'running')) return prev;
      return prev.map((t) =>
        t.outcome === 'running'
          ? { ...t, outcome: 'unknown', outcomeText: 'Turn ended without a result event.' }
          : t
      );
    });
  }, [status]);

  const errors = useMemo(
    () =>
      turns.flatMap((t) => [
        ...(t.outcome === 'error' ? [{ taskId: t.taskId, text: t.outcomeText || 'Turn failed' }] : []),
        ...t.tools
          .filter((c) => c.failure === 'certain')
          .map((c) => ({ taskId: t.taskId, text: c.result || c.detail })),
      ]),
    [turns]
  );

  const liveApprovals = useMemo(() => approvals.filter((a) => !a.stale), [approvals]);

  return {
    turns,
    approvals,
    liveApprovals,
    status,
    relay,
    relayMessage,
    configured,
    loadError,
    booted,
    errors,
    lastId,
  };
}
