// server/server.ts — Story 3.1 (serve the Form) + 3.2 (POST /preview) + 3.3 (run/stream).
// A single node:http server, bound to 127.0.0.1 only (NFR-2), that:
//   GET  /         → the single-page Form (server/page.ts)
//   POST /preview  → { args, preview } from core/compose.ts (read-only; no CSRF needed)
//   GET  /events   → SSE stream carrying run output + exit (AD-5)
//   POST /run      → compose + spawn (args array, never shell) and stream (AD-6)
//   POST /stop     → kill the running child
// State-changing endpoints (/run, /stop) fail closed on a missing/mismatched Origin (CSRF,
// AD-6). Exactly one run in flight; the SSE connection owns the run, so a disconnect kills
// the child. The API key never appears here — only the Schema and tool name are served.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { Schema } from '../core/schema.js';
import { compose } from '../core/compose.js';
import { renderPage } from './page.js';
import { CLIENT_SCRIPT } from './client.js';
import { RunController } from './run.js';
import type { RunSink, SpawnLike } from './run.js';

const DEFAULT_PORT = 5177;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 512 * 1024;

export interface ServeOptions {
  schema: Schema;
  host?: string;
  /** Preferred port; on EADDRINUSE the server falls back to an OS-assigned free port. */
  port?: number;
}

export interface ServeDeps {
  /** Injected for run tests; defaults to a controller over real spawn. */
  controller?: RunController;
  spawnFn?: SpawnLike;
}

export interface RunningServer {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

/** Read a request body up to a hard cap; returns '' if the cap is exceeded (caller 400s). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!aborted) resolve(null);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/** Listen with EADDRINUSE fallback: try `port`, and on a clash retry on port 0 (OS-assigned)
 *  so a busy default never crashes the launch (AC 3.1). Resolves the actually-bound port. */
function listenWithFallback(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError);
      if (err.code === 'EADDRINUSE' && port !== 0) {
        listenWithFallback(server, 0, host).then(resolve, reject);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}

/**
 * Start the Form server for `schema`. Binds 127.0.0.1 only; falls back off an occupied port.
 * Resolves once listening, with the bound URL and a `close()` that tears down cleanly
 * (ends any SSE stream and kills a running child).
 */
export async function startServer(opts: ServeOptions, deps: ServeDeps = {}): Promise<RunningServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const controller = deps.controller ?? new RunController(deps.spawnFn);
  const page = renderPage(opts.schema, CLIENT_SCRIPT);

  let boundPort = 0;
  // The single active SSE response; the run's output sink and lifecycle are tied to it.
  let sseRes: ServerResponse | null = null;

  /** CSRF fail-closed: the Origin must be present AND match our own bound host:port. */
  function originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) return false;
    // Accept our own bound host and the 127.0.0.1/localhost alias for it.
    const allowed = new Set([`http://${host}:${boundPort}`, `http://localhost:${boundPort}`, `http://127.0.0.1:${boundPort}`]);
    return allowed.has(origin);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendText(res, 500, 'instagui: internal error');
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = (req.url ?? '/').split('?')[0];

    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }

    if (method === 'POST' && url === '/preview') {
      const raw = await readBody(req);
      if (raw === null) return sendText(res, 413, 'body too large');
      let state: unknown;
      try {
        state = raw.trim() === '' ? {} : JSON.parse(raw);
      } catch {
        return sendText(res, 400, 'invalid JSON');
      }
      const { args, preview } = compose(opts.schema, (state as object) ?? {});
      return sendJson(res, 200, { args, preview });
    }

    if (method === 'GET' && url === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      // Replace any prior stream; the newest tab owns the run.
      if (sseRes && sseRes !== res) sseRes.end();
      sseRes = res;
      req.on('close', () => {
        if (sseRes === res) {
          sseRes = null;
          // Disconnect (tab close/reload) must not leave an orphan child (AD-5).
          controller.stop();
        }
      });
      return;
    }

    if (method === 'POST' && url === '/run') {
      if (!originAllowed(req)) return sendText(res, 403, 'forbidden: bad Origin');
      const sink = sseRes;
      if (!sink) return sendText(res, 428, 'open the event stream first');
      const raw = await readBody(req);
      if (raw === null) return sendText(res, 413, 'body too large');
      let state: unknown;
      try {
        state = raw.trim() === '' ? {} : JSON.parse(raw);
      } catch {
        return sendText(res, 400, 'invalid JSON');
      }
      const { args } = compose(opts.schema, (state as object) ?? {});
      const runSink: RunSink = {
        out: (chunk) => sseWrite(sink, 'out', chunk),
        end: (result) => sseWrite(sink, 'exit', result),
      };
      const outcome = controller.start(opts.schema.tool, args, runSink);
      if (!outcome.ok) return sendText(res, 409, outcome.reason);
      return sendText(res, 202, 'running');
    }

    if (method === 'POST' && url === '/stop') {
      if (!originAllowed(req)) return sendText(res, 403, 'forbidden: bad Origin');
      const killed = controller.stop();
      return sendText(res, 200, killed ? 'stopping' : 'nothing to stop');
    }

    return sendText(res, 404, 'not found');
  }

  /** Serialize a value as one SSE event. JSON-encoded data stays single-line even with
   *  embedded newlines, so the framing is never broken by tool output. */
  function sseWrite(res: ServerResponse, event: string, data: unknown): void {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  boundPort = await listenWithFallback(server, opts.port ?? DEFAULT_PORT, host);
  const url = `http://${host}:${boundPort}/`;

  return {
    url,
    host,
    port: boundPort,
    close(): Promise<void> {
      return new Promise((resolve) => {
        controller.stop();
        if (sseRes) {
          sseRes.end();
          sseRes = null;
        }
        server.close(() => resolve());
      });
    },
  };
}
