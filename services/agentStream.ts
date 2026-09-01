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

/* ------------------------------------------------------------------------- *
 * Making the transcript readable
 *
 * The agent's own detail is a raw shell command. Twenty-five lines of
 * `grep -rn ... | head -20` is an accurate log and an unreadable one. These
 * turn each call into a short phrase describing what was actually done, with
 * the exact command still one click away.
 * ------------------------------------------------------------------------- */

/** `/work/repos/hotpoint-front/admin/src/app/api/x.ts` -> `hotpoint-front/…/x.ts` */
export function shortPath(p: string): string {
  if (!p) return '';
  const clean = p.replace(/^\/work\/repos\//, '').replace(/^\/work\//, '').replace(/^\.\//, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

const firstQuoted = (s: string): string | null => {
  const m = s.match(/"([^"]{1,60})"|'([^']{1,60})'/);
  return m ? (m[1] ?? m[2]) : null;
};

/** A short human phrase for a shell command. */
function describeBash(cmd: string): string {
  const c = cmd.trim().replace(/^\(\s*/, '');
  const head = c.split(/[\s;|&]+/)[0] || '';
  const q = firstQuoted(c);
  const pathIn = (s: string) => {
    const m = s.match(/(\/[A-Za-z0-9._\-\/]{4,})/);
    return m ? shortPath(m[1]) : '';
  };

  if (/^gpt\s+image\b/.test(c)) return `Generated an image${q ? `: “${q}”` : ''}`;
  if (/^gpt\s+tts\b/.test(c)) return `Generated speech${q ? `: “${q}”` : ''}`;
  if (/^gpt\s+(ask|review)\b/.test(c)) return 'Asked GPT-5 for a second opinion';

  if (/^ls\b/.test(c)) { const p = pathIn(c); return p ? `Listed files in ${p}` : 'Listed files'; }
  if (/^(cat|head|tail|less)\b/.test(c) || /^sed\s+-n/.test(c)) { const p = pathIn(c); return p ? `Read ${p}` : 'Read a file'; }
  if (/^(grep|rg|ag)\b/.test(c) || /\|\s*grep\b/.test(c)) return q ? `Searched for “${q}”` : 'Searched the code';
  if (/^find\b/.test(c)) { const p = pathIn(c); return p ? `Looked for files in ${p}` : 'Looked for files'; }
  if (/^awk\b|^cut\b|^sort\b|^uniq\b|^wc\b/.test(c)) return 'Processed some output';
  // `which ssh` / `command -v coolify` rendered as "Ran which" / "Ran command",
  // which says nothing. Name the thing being looked for instead.
  if (/^(which|type)\b|^command\s+-v\b/.test(c)) {
    const m = c.match(/^(?:which|type|command\s+-v)\s+([A-Za-z0-9_.\-]+)/);
    return m ? `Checked whether ${m[1]} is installed` : 'Checked which tools are available';
  }
  if (/^printenv\b|^env\b/.test(c)) return 'Checked the environment settings';

  if (/^git\s+push/.test(c)) return 'Pushed to git';
  if (/^git\s+commit/.test(c)) return 'Committed changes';
  if (/^git\s+(log|show)/.test(c)) return 'Checked git history';
  if (/^git\s+(status|diff)/.test(c)) return 'Checked what changed';
  if (/^git\s+(pull|fetch|clone)/.test(c)) return 'Fetched from git';
  if (/^git\b/.test(c)) return 'Ran a git command';

  if (/^npm\s+run\s+build|^yarn\s+build|^pnpm\s+build/.test(c)) return 'Built the project';
  if (/^npm\s+(test|run\s+test)/.test(c)) return 'Ran the tests';
  if (/^npm\s+(i|install|ci)\b/.test(c)) return 'Installed dependencies';
  if (/^npx\s+tsc/.test(c)) return 'Type-checked the code';
  if (/^npm\b|^npx\b|^yarn\b|^pnpm\b/.test(c)) return 'Ran a package command';

  if (/^curl\b|^wget\b/.test(c)) {
    const m = c.match(/https?:\/\/([^\/\s"']+)/);
    return m ? `Fetched ${m[1]}` : 'Made a web request';
  }
  if (/^ssh\b/.test(c)) {
    const m = c.match(/(?:root@|@)([\w.\-]+)/);
    return m ? `Ran a command on ${m[1]}` : 'Connected to a server';
  }
  if (/^docker\b/.test(c)) return 'Ran a Docker command';
  if (/^coolify\b/.test(c)) return 'Checked Coolify';
  if (/^wasend\b/.test(c)) return 'Submitted a WhatsApp draft for approval';
  if (/^(python3?|node)\s+-e\b/.test(c) || /<<'?EOF'?/.test(c)) return 'Ran a small script';
  if (/^echo\b|^printf\b/.test(c)) return 'Printed some output';
  if (/^mkdir\b|^cp\b|^mv\b|^chmod\b|^rm\b/.test(c)) return 'Moved files around';

  return head ? `Ran ${head}` : 'Ran a command';
}

/** A short human phrase for any tool call. */
export function describeCall(tool: string, detail: string): string {
  const d = (detail || '').trim();
  switch (tool) {
    case 'Bash':      return describeBash(d);
    case 'Read':      return `Read ${shortPath(d)}`;
    case 'Write':     return `Wrote ${shortPath(d)}`;
    case 'Edit':      return `Edited ${shortPath(d)}`;
    case 'NotebookEdit': return `Edited ${shortPath(d)}`;
    case 'Glob':      return 'Looked for files';
    case 'Grep':      return firstQuoted(d) ? `Searched for “${firstQuoted(d)}”` : 'Searched the code';
    case 'WebFetch': {
      const m = d.match(/https?:\/\/([^\/\s"']+)/);
      return m ? `Read ${m[1]}` : 'Read a web page';
    }
    case 'WebSearch': return firstQuoted(d) ? `Searched the web for “${firstQuoted(d)}”` : 'Searched the web';
    case 'Skill': {
      const m = d.match(/"skill"\s*:\s*"([^"]+)"/);
      return m ? `Used the ${m[1]} skill` : 'Used a skill';
    }
    case 'Task':       return 'Ran a sub-agent';
    case 'ToolSearch': return 'Looked up a tool';
    case 'TodoWrite':  return 'Updated its plan';
    default:           return tool ? `Used ${tool}` : 'Did something';
  }
}

/** One line summarising a whole turn's activity, e.g. "12 steps · 3 searches". */
export function summariseCounts(labels: string[]): string {
  if (labels.length === 0) return 'no steps';
  const n = labels.length;
  return `${n} step${n === 1 ? '' : 's'}`;
}
