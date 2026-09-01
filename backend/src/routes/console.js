import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config/env.js';
import * as agent from '../services/agentClient.js';

const router = express.Router();

/**
 * Live agent console.
 *
 * Every route here can reach `POST /control/message` on the agent, which runs
 * Claude with Bash across every client repo. That makes this router the most
 * dangerous surface in the app, and it is fenced accordingly:
 *
 *   - `CONSOLE_USER_IDS` is an allowlist. Empty means nobody, so the feature is
 *     off until a person is deliberately named.
 *   - The allowlist is enforced in middleware AND re-checked in each handler.
 *     Authorization that exists only in middleware is one careless `router.use`
 *     reorder away from being no authorization at all.
 *   - The agent control token never appears in a response. Callers get
 *     `configured: boolean`, mirroring the `fleetApiKeySet` idea in kpi.js.
 */

const requireConsoleUser = (req, res, next) => {
  if (!config.agentConsole.userIds.includes(req.user?.id)) {
    return res.status(403).json({ error: 'Agent console is not enabled for this account' });
  }
  next();
};

/** Repeated inside handlers on purpose. See the note above. */
const denied = (req, res) => {
  if (!config.agentConsole.userIds.includes(req.user?.id)) {
    res.status(403).json({ error: 'Agent console is not enabled for this account' });
    return true;
  }
  return false;
};

const secure = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
};

router.use(authenticate, requireConsoleUser);

/** Turns a client error into an honest status rather than a 500. */
const relayError = (err, res) => {
  if (err instanceof agent.AgentDownError) {
    return res.status(503).json({ error: err.message, agentDown: true });
  }
  if (err instanceof agent.AgentHttpError) {
    return res.status(err.status === 404 ? 404 : 502).json({
      error: err.body?.error || `Agent returned ${err.status}`,
      agentStatus: err.status,
    });
  }
  throw err;
};

// --- read ------------------------------------------------------------------

/**
 * One call the console can boot from: config state, live status, and the
 * transcript. `status` is fetched separately because it is ephemeral and is
 * never part of the transcript.
 */
router.get('/bootstrap', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);

  if (!agent.configured()) {
    return res.json({ configured: false, agentDown: true, status: null, transcript: [] });
  }

  const after = Number.parseInt(req.query.after, 10);
  try {
    const [status, transcript] = await Promise.all([
      agent.getStatus(),
      agent.getTranscript(Number.isInteger(after) ? after : undefined),
    ]);
    res.json({ configured: true, agentDown: false, status, transcript });
  } catch (err) {
    if (err instanceof agent.AgentDownError) {
      // Configured but not answering is exactly the state the user complains he
      // cannot see today, so it is a normal 200 the UI can render, not an error.
      return res.json({ configured: true, agentDown: true, reason: err.message, status: null, transcript: [] });
    }
    return relayError(err, res);
  }
}));

router.get('/status', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  try {
    res.json(await agent.getStatus());
  } catch (err) {
    return relayError(err, res);
  }
}));

/**
 * Is Hermes actually reachable?
 *
 * Previously the UI inferred this from whether a Hermes tool call was in flight,
 * so an idle-but-healthy Hermes rendered identically to a dead one. This asks
 * the capability service directly. Its /health needs no credentials, so no
 * secret is involved.
 */
router.get('/hermes', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  const url = config.agentConsole.capsvcUrl;
  if (!url) return res.json({ state: 'unconfigured' });
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(6000) });
    return res.json({ state: r.ok ? 'up' : 'down', status: r.status });
  } catch (err) {
    return res.json({ state: 'down', reason: err?.name === 'TimeoutError' ? 'timeout' : 'unreachable' });
  }
}));

// --- write -----------------------------------------------------------------

router.post('/message', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 32_000) return res.status(413).json({ error: 'message too long' });

  try {
    res.json(await agent.sendMessage({ text, source: 'web', autoApprove: Boolean(req.body?.autoApprove) }));
  } catch (err) {
    return relayError(err, res);
  }
}));

router.post('/stop', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  try {
    res.json(await agent.stop());
  } catch (err) {
    return relayError(err, res);
  }
}));

router.post('/approval', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  const { approvalId, decision } = req.body || {};
  if (!approvalId) return res.status(400).json({ error: 'approvalId is required' });
  if (decision !== 'approve' && decision !== 'deny') {
    return res.status(400).json({ error: 'decision must be approve or deny' });
  }
  try {
    res.json(await agent.resolveApproval({ approvalId, decision }));
  } catch (err) {
    return relayError(err, res);
  }
}));

router.post('/scope', asyncHandler(async (req, res) => {
  if (denied(req, res)) return;
  secure(res);
  try {
    res.json(await agent.setScope(req.body || {}));
  } catch (err) {
    return relayError(err, res);
  }
}));

// --- live stream -----------------------------------------------------------

const HEARTBEAT_MS = 20_000;

/**
 * Relays the agent's SSE stream to the browser.
 *
 * Three things this must get right, each of which otherwise produces a console
 * that looks alive while showing nothing:
 *
 *  1. A heartbeat generated HERE, not forwarded from the agent. If the upstream
 *     dies quietly, a forwarded heartbeat dies with it and the browser sees a
 *     frozen screen instead of a disconnect.
 *  2. Explicit `relay` frames on connect and on failure, so "cannot reach the
 *     agent" is a rendered banner rather than silence.
 *  3. No compression and no buffering. `X-Accel-Buffering: no` covers nginx;
 *     Traefik's gzip middleware must exclude text/event-stream or frames arrive
 *     in batches. Verify with `curl -N` against the public host, not locally.
 */
router.get('/stream', (req, res) => {
  if (denied(req, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
    'X-Content-Type-Options': 'nosniff',
  });
  res.flushHeaders?.();

  let closed = false;
  const upstream = new AbortController();

  const send = (obj) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': hb\n\n');
  }, HEARTBEAT_MS);

  const shutdown = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    upstream.abort();
    res.end();
  };

  req.on('close', shutdown);
  res.on('error', shutdown);

  (async () => {
    send({ kind: 'relay', state: 'connecting' });

    if (!agent.configured()) {
      send({ kind: 'relay', state: 'down', message: 'Agent console is not configured on the server' });
      return shutdown();
    }

    try {
      const upstreamRes = await agent.openStream(upstream.signal);
      send({ kind: 'relay', state: 'up' });

      // Byte-level passthrough. The agent's frames are already `data: {...}\n\n`
      // JSON, and re-parsing them here would mean this relay had to understand
      // every event kind the agent will ever add.
      for await (const chunk of upstreamRes.body) {
        if (closed) break;
        res.write(chunk);
      }
      if (!closed) {
        send({ kind: 'relay', state: 'down', message: 'Agent closed the stream' });
      }
    } catch (err) {
      if (!closed && err?.name !== 'AbortError') {
        send({ kind: 'relay', state: 'down', message: err?.message || 'Agent unreachable' });
      }
    } finally {
      shutdown();
    }
  })();
});

export default router;
