// Story 3.3 — the run path against a REAL server + REAL child processes. Covers the security
// ACs strictly: args-array spawn (values verbatim, never shell), CSRF fail-closed on /run and
// /stop, one run in flight, Stop kills, SSE-disconnect kills (no orphan), live streaming, and
// the exit code at the end. The command under test is this Node binary echoing its argv, so
// we can prove a hostile value arrives as a single, unmodified argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../src/server/server.js';
import type { RunningServer } from '../src/server/server.js';
import type { Schema } from '../src/core/schema.js';

const NODE = process.execPath;

// A schema whose composed command runs `node -e <script> <arg1>`. The `eval` option carries a
// script (supplied per-run in the request body); the positional carries a value we can inspect.
function nodeSchema(): Schema {
  return {
    tool: NODE,
    summary: '',
    options: [{ name: 'eval', flag: '-e', type: 'string', description: '', enumValues: [], required: false, group: '' }],
    positionals: [{ name: 'arg1', type: 'string', description: '', required: false, variadic: false }],
  };
}
const ECHO_ARGV = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const PRINT_PID_THEN_WAIT = 'process.stdout.write("PID:"+process.pid+"\\n");setInterval(()=>{},1000)';

/** POST via node:http so we can set the (browser-forbidden-to-fetch) Origin header freely. */
function httpPost(
  port: number,
  path: string,
  opts: { body?: string; origin?: string | null } = {},
): Promise<{ status: number; body: string }> {
  const body = opts.body ?? '';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  };
  if (opts.origin) headers.origin = opts.origin;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Minimal SSE client over fetch: collects events, lets a test await a matching one, and can
 *  disconnect (abort) to simulate a tab close/reload. */
function openEvents(url: string) {
  const ac = new AbortController();
  const events: { event: string; data: string }[] = [];
  const waiters: { pred: (e: { event: string; data: string }) => boolean; resolve: (e: { event: string; data: string }) => void }[] = [];

  const ready = fetch(url, { signal: ac.signal, headers: { accept: 'text/event-stream' } }).then((res) => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const rec = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = { event: 'message', data: '' };
            let isComment = true;
            for (const line of rec.split('\n')) {
              if (line.startsWith(':')) continue;
              isComment = false;
              if (line.startsWith('event:')) ev.event = line.slice(6).trim();
              else if (line.startsWith('data:')) ev.data += (ev.data ? '\n' : '') + line.slice(5).replace(/^ /, '');
            }
            if (isComment) continue;
            events.push(ev);
            for (const w of waiters.slice()) {
              if (w.pred(ev)) {
                w.resolve(ev);
                waiters.splice(waiters.indexOf(w), 1);
              }
            }
          }
        }
      } catch {
        /* aborted / closed */
      }
    })();
    return res;
  });

  return {
    ready,
    events,
    waitFor(pred: (e: { event: string; data: string }) => boolean, ms = 5000): Promise<{ event: string; data: string }> {
      const existing = events.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        const t = setTimeout(() => {
          const idx = waiters.indexOf(w);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            reject(new Error('timeout waiting for SSE event'));
          }
        }, ms);
        t.unref?.();
      });
    },
    abort: () => ac.abort(),
  };
}

/** Decode an 'out' SSE event back to the raw chunk text (server JSON-encodes each chunk). */
function chunk(ev: { data: string }): string {
  return JSON.parse(ev.data) as string;
}

test('CSRF fail-closed: POST /run and /stop are rejected with a missing or mismatched Origin', async () => {
  const srv: RunningServer = await startServer({ schema: nodeSchema(), port: 0 });
  try {
    // Missing Origin → 403, no run starts.
    const noOrigin = await httpPost(srv.port, '/run', { body: JSON.stringify({}) });
    assert.equal(noOrigin.status, 403);

    // Wrong Origin → 403.
    const badOrigin = await httpPost(srv.port, '/run', { body: JSON.stringify({}), origin: 'http://evil.example' });
    assert.equal(badOrigin.status, 403);

    // /stop is equally protected.
    const badStop = await httpPost(srv.port, '/stop', { origin: 'http://evil.example' });
    assert.equal(badStop.status, 403);
  } finally {
    await srv.close();
  }
});

test('args-array spawn: a value with spaces/;/&& reaches the child as ONE verbatim argument', async () => {
  const srv = await startServer({ schema: nodeSchema(), port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    const hostile = 'a b; rm -rf / && echo "pwned"';
    const state = JSON.stringify({ options: { eval: ECHO_ARGV }, positionals: { arg1: hostile } });
    const run = await httpPost(srv.port, '/run', { body: state, origin });
    assert.equal(run.status, 202);

    const outEv = await sse.waitFor((e) => e.event === 'out');
    const argv = JSON.parse(chunk(outEv)) as string[];
    assert.deepEqual(argv, [hostile]); // single, unmodified arg — no shell interpretation

    const exit = await sse.waitFor((e) => e.event === 'exit');
    assert.equal((JSON.parse(exit.data) as { code: number }).code, 0);
  } finally {
    sse.abort();
    await srv.close();
  }
});

test('streaming + exit code: output streams over SSE and a non-zero exit is reported', async () => {
  const script = 'process.stdout.write("line1\\n");process.exit(3)';
  const srv = await startServer({ schema: nodeSchema(), port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    const run = await httpPost(srv.port, '/run', { body: JSON.stringify({ options: { eval: script } }), origin });
    assert.equal(run.status, 202);

    const outEv = await sse.waitFor((e) => e.event === 'out' && chunk(e).includes('line1'));
    assert.match(chunk(outEv), /line1/);
    const exit = await sse.waitFor((e) => e.event === 'exit');
    assert.equal((JSON.parse(exit.data) as { code: number }).code, 3); // non-zero surfaced
  } finally {
    sse.abort();
    await srv.close();
  }
});

test('ENOENT at run time: a missing binary yields a friendly message + a failed-start exit', async () => {
  const bogus = 'instagui-nonexistent-binary-xyzzy';
  const schema: Schema = { tool: bogus, summary: '', options: [], positionals: [] };
  const srv = await startServer({ schema, port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    const run = await httpPost(srv.port, '/run', { body: JSON.stringify({}), origin });
    assert.equal(run.status, 202);

    const outEv = await sse.waitFor((e) => e.event === 'out' && /not installed or not on your PATH/.test(chunk(e)));
    assert.match(chunk(outEv), new RegExp(`"${bogus}" is not installed or not on your PATH`));
    assert.doesNotMatch(chunk(outEv), /spawn .* ENOENT/); // raw Node error not leaked to the panel

    const exit = await sse.waitFor((e) => e.event === 'exit');
    assert.equal((JSON.parse(exit.data) as { code: number | null }).code, null); // failed to start
  } finally {
    sse.abort();
    await srv.close();
  }
});

test('one run in flight: a second /run while running is rejected (409)', async () => {
  const srv = await startServer({ schema: nodeSchema(), port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    const body = JSON.stringify({ options: { eval: PRINT_PID_THEN_WAIT } });
    const first = await httpPost(srv.port, '/run', { body, origin });
    assert.equal(first.status, 202);
    await sse.waitFor((e) => e.event === 'out'); // it's live

    const second = await httpPost(srv.port, '/run', { body, origin });
    assert.equal(second.status, 409);

    const stop = await httpPost(srv.port, '/stop', { origin });
    assert.equal(stop.status, 200);
    await sse.waitFor((e) => e.event === 'exit');
  } finally {
    sse.abort();
    await srv.close();
  }
});

test('Stop kills the running child', async () => {
  const srv = await startServer({ schema: nodeSchema(), port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    await httpPost(srv.port, '/run', { body: JSON.stringify({ options: { eval: PRINT_PID_THEN_WAIT } }), origin });
    const pidEv = await sse.waitFor((e) => e.event === 'out' && chunk(e).includes('PID:'));
    const pid = Number(chunk(pidEv).match(/PID:(\d+)/)![1]);

    const stop = await httpPost(srv.port, '/stop', { origin });
    assert.equal(stop.status, 200);
    await sse.waitFor((e) => e.event === 'exit');

    // The child is actually gone.
    await assertProcessGone(pid);
  } finally {
    sse.abort();
    await srv.close();
  }
});

test('SSE disconnect (tab close/reload) kills the child — no orphan', async () => {
  const srv = await startServer({ schema: nodeSchema(), port: 0 });
  const origin = new URL(srv.url).origin;
  const sse = openEvents(new URL('/events', srv.url).toString());
  try {
    await sse.ready;
    await httpPost(srv.port, '/run', { body: JSON.stringify({ options: { eval: PRINT_PID_THEN_WAIT } }), origin });
    const pidEv = await sse.waitFor((e) => e.event === 'out' && chunk(e).includes('PID:'));
    const pid = Number(chunk(pidEv).match(/PID:(\d+)/)![1]);

    // Simulate the browser tab closing: drop the SSE connection.
    sse.abort();

    // The server must reap the child.
    await assertProcessGone(pid);
  } finally {
    await srv.close();
  }
});

/** Poll until `pid` no longer exists (process.kill(pid, 0) throws ESRCH). Generous deadline:
 *  a client disconnect must propagate (socket close → SIGTERM) which can lag on Windows/CI. */
async function assertProcessGone(pid: number, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) return;
    if (Date.now() > deadline) throw new Error(`process ${pid} still alive — orphaned child`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
