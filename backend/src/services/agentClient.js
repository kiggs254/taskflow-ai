import { config } from '../config/env.js';

/**
 * Thin client for the kiggs-agent control server.
 *
 * The agent's control token authorises arbitrary shell across every client repo,
 * so it lives here and nowhere else: no route echoes it, no response carries it,
 * and the browser never sees it. Callers get `configured()` to render state, not
 * the value.
 *
 * The agent listens on the private `coolify` Docker network and is deliberately
 * not published, so in production AGENT_URL is a container name reachable only
 * from a backend on the same host. To develop against it, SSH-tunnel to the
 * agent's address on that network and point AGENT_URL at 127.0.0.1.
 */

const TIMEOUT_MS = 15_000;

export const configured = () => Boolean(config.agentConsole.url && config.agentConsole.token);

const base = () => config.agentConsole.url.replace(/\/+$/, '');

const authHeaders = () => ({ Authorization: `Bearer ${config.agentConsole.token}` });

/**
 * An error the routes can turn into an honest status code. `AgentDownError`
 * specifically means we could not reach the agent at all, which the UI renders
 * as "agent unreachable" rather than as a failed request.
 */
export class AgentDownError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentDownError';
  }
}

export class AgentHttpError extends Error {
  constructor(status, body) {
    super(`Agent returned ${status}`);
    this.name = 'AgentHttpError';
    this.status = status;
    this.body = body;
  }
}

async function call(path, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  if (!configured()) throw new AgentDownError('Agent console is not configured');

  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        ...authHeaders(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    // Connection refused, DNS failure, timeout. The agent is not answering, which
    // is a different thing from the agent answering with an error.
    throw new AgentDownError(err?.name === 'TimeoutError' ? 'Agent timed out' : 'Agent unreachable');
  }

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }

  if (!res.ok) throw new AgentHttpError(res.status, unwrap(parsed));
  return unwrap(parsed);
}

/**
 * The control server answers JSON routes as `{status:"success", data:{...}}` but
 * emits BARE event objects on the SSE stream. Verified against the live agent,
 * not assumed. Unwrap here so callers deal in one shape.
 */
function unwrap(parsed) {
  if (parsed && typeof parsed === 'object' && 'status' in parsed && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

export const getStatus = () => call('/control/status');
export const getScope = () => call('/control/scope');

/**
 * `after` is the last durable event id the client already has. The agent emits no
 * SSE `id:` field and ignores Last-Event-ID, so resume after a dropped connection
 * has to be done here rather than by the browser's EventSource machinery.
 */
export const getTranscript = async (after) => {
  const data = await call(`/control/transcript${Number.isInteger(after) ? `?after=${after}` : ''}`);
  return Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
};

export const sendMessage = (payload) => call('/control/message', { method: 'POST', body: payload });
export const stop = () => call('/control/stop', { method: 'POST', body: {} });
export const resolveApproval = (payload) => call('/control/approval', { method: 'POST', body: payload });
export const setScope = (payload) => call('/control/scope', { method: 'POST', body: payload });

/**
 * Opens the agent's SSE stream and hands back the raw Response so the caller can
 * pipe it. Not routed through `call()` because the body must stay unread.
 */
export async function openStream(signal) {
  if (!configured()) throw new AgentDownError('Agent console is not configured');
  let res;
  try {
    res = await fetch(`${base()}/control/stream`, {
      headers: { ...authHeaders(), Accept: 'text/event-stream' },
      signal,
    });
  } catch (err) {
    throw new AgentDownError(err?.name === 'AbortError' ? 'Aborted' : 'Agent unreachable');
  }
  if (!res.ok || !res.body) {
    throw new AgentHttpError(res.status, { error: 'stream refused' });
  }
  return res;
}
