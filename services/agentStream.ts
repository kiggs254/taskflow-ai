import { apiFetch, getApiBase } from './apiService';

/**
 * SSE client for the agent console.
 *
 * Deliberately NOT `EventSource`, for two reasons:
 *
 *  1. EventSource cannot set headers, and TaskFlow's auth is an explicit
 *     `Authorization: Bearer`. Smuggling the token through a query string would
 *     put it in every proxy access log.
 *  2. EventSource's automatic reconnect is useless here anyway: the agent emits
 *     no SSE `id:` field and ignores `Last-Event-ID`, so resuming without a gap
 *     means re-fetching the transcript from the last id we actually saw. Only a
 *     manual client can do that.
 *
 * Verified against the live agent: the JSON routes answer
 * `{status,data}` but the stream carries BARE event objects, plus one named
 * `event: ready` frame at the start.
 */

/** Raw event as it comes off the wire. Kinds are the agent's own. */
export interface RawAgentEvent {
  kind: string;
  id?: number;
  ts?: number;
  taskId?: string;
  scope?: string;
  text?: string;
  detail?: string;
  tool?: string;
  source?: string;
  // status
  busy?: boolean;
  scopeLabel?: string;
  queueLength?: number;
  activeTaskId?: string | null;
  hasSession?: boolean;
  // relay (synthesised by our backend, never by the agent)
  state?: 'connecting' | 'up' | 'reconnecting' | 'down';
  message?: string;
  // approvals
  approvalId?: string;
  decision?: string;
  by?: string;
  [k: string]: unknown;
}

export type Lane = 'claude' | 'hermes' | 'codex';

/**
 * Which engine a Bash call actually reaches.
 *
 * This distinction is not cosmetic and must not be blurred: `gpt ask` and
 * `gpt review` spawn the OpenAI Codex CLI *inside the agent container* and never
 * touch Hermes. Only `gpt image` and `gpt tts` reach Hermes through capsvc.
 * Labelling all four "Hermes" would tell the user something untrue.
 */
export function laneFor(tool?: string, detail?: string): Lane {
  if (tool !== 'Bash' || !detail) return 'claude';
  if (/(^|[;&|]\s*)gpt\s+(image|tts)\b/.test(detail)) return 'hermes';
  if (/(^|[;&|]\s*)gpt\s+(ask|review)\b/.test(detail)) return 'codex';
  return 'claude';
}

export const LANE_LABEL: Record<Lane, string> = {
  claude: 'Claude',
  hermes: 'Hermes',
  codex: 'GPT-5 (Codex, in-container)',
};

/**
 * Failure detection, in two honest tiers.
 *
 * The protocol carries no exit code, no `is_error` and no tool name on results,
 * so nothing here can *assert* a failure. `certain` is reserved for the agent's
 * own literal refusal strings, which are unambiguous. Everything else is
 * `suspected` and is rendered as such.
 */
export function detectFailure(detail?: string): 'certain' | 'suspected' | null {
  if (!detail) return null;
  const d = detail.trim();
  if (/^(Auto-build refused:|Blocked: destructive command\.)/.test(d)) return 'certain';
  if (/^(Error\b|error:|fatal:|npm ERR!|Traceback|command failed)/i.test(d)) return 'suspected';
  if (/\b(busy, try again|capability call failed|hermes timed out)\b/i.test(d)) return 'suspected';
  return null;
}

/** Generated media the agent mentions. Only /work paths could ever be fetched. */
export function detectMedia(detail?: string): { path: string; kind: 'image' | 'audio'; fetchable: boolean } | null {
  if (!detail) return null;
  const m = detail.match(/(\/(?:opt\/data\/cache\/(?:images|audio)|work)\/[^\s"'`)]+\.(png|jpe?g|webp|gif|mp3|wav|ogg|opus))/i);
  if (!m) return null;
  const path = m[1];
  const kind = /\.(mp3|wav|ogg|opus)$/i.test(path) ? 'audio' : 'image';
  // Files under the Hermes container's own volume are in a different container
  // and nothing on this side can read them.
  return { path, kind, fetchable: path.startsWith('/work/') };
}

type Handlers = {
  onEvent: (e: RawAgentEvent) => void;
  onRelay: (state: 'connecting' | 'up' | 'reconnecting' | 'down', message?: string) => void;
};

/**
 * Opens the stream and keeps it open, reconnecting with backoff.
 *
 * The watchdog matters as much as the reconnect: a half-dead socket produces a
 * screen that looks alive and shows nothing, which is precisely the failure the
 * user complained about. Our backend heartbeats every 20s, so 45s of total
 * silence is definitive rather than merely quiet.
 */
export function connectAgentStream(token: string, h: Handlers): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      // Nothing at all for 45s, including heartbeats. Force a reconnect.
      controller?.abort();
    }, 45_000);
  };

  const run = async () => {
    while (!closed) {
      controller = new AbortController();
      try {
        h.onRelay(attempt === 0 ? 'connecting' : 'reconnecting');
        const res = await apiFetch(`${getApiBase()}/console/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
          // apiFetch already fired onSessionExpired for a 401; either way,
          // retrying cannot help.
          h.onRelay('down', res.status === 403 ? 'This account is not enabled for the agent console' : 'Session expired');
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream refused (${res.status})`);

        attempt = 0;
        armWatchdog();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          armWatchdog();
          buf += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. Keep the trailing partial.
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue; // ': hb' and 'event: ready'
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const evt = JSON.parse(payload) as RawAgentEvent;
                if (evt.kind === 'relay') h.onRelay(evt.state || 'down', evt.message);
                else h.onEvent(evt);
              } catch {
                /* a frame we cannot parse is not worth killing the stream over */
              }
            }
          }
        }
      } catch {
        if (closed) return;
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }

      if (closed) return;
      attempt += 1;
      h.onRelay('reconnecting', `attempt ${attempt}`);
      const wait = Math.min(1000 * 2 ** Math.min(attempt, 5), 20_000);
      await new Promise((r) => setTimeout(r, wait));
    }
  };

  void run();

  return () => {
    closed = true;
    if (watchdog) clearTimeout(watchdog);
    controller?.abort();
  };
}
