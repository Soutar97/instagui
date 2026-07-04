// Story 3.1 — the Form server: binds 127.0.0.1 only, serves the single-page Form, and falls
// back off an occupied port instead of crashing on EADDRINUSE. (Preview/run behaviour is
// covered in preview.test.ts and run-integration.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from '../src/server/server.js';
import type { Schema } from '../src/core/schema.js';

const schema: Schema = {
  tool: 'demotool',
  summary: '',
  options: [{ name: 'verbose', flag: '-v', type: 'boolean', description: '', enumValues: [], required: false, group: '' }],
  positionals: [],
};

test('binds 127.0.0.1 and serves the Form (200 text/html with the tool name)', async () => {
  const srv = await startServer({ schema, port: 0 });
  try {
    assert.equal(srv.host, '127.0.0.1');
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(srv.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /<title>guiup — demotool<\/title>/);
    assert.match(body, /data-name="verbose"/);
  } finally {
    await srv.close();
  }
});

test('EADDRINUSE fallback: a busy preferred port does not crash — a free port is bound', async () => {
  // Occupy a port on 127.0.0.1, then ask the Form server to prefer that same port.
  const blocker = createServer(() => {});
  const busyPort = await new Promise<number>((resolve) => {
    blocker.listen(0, '127.0.0.1', () => {
      const addr = blocker.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  const srv = await startServer({ schema, port: busyPort });
  try {
    assert.notEqual(srv.port, busyPort); // fell back to a different, free port
    const res = await fetch(srv.url);
    assert.equal(res.status, 200);
  } finally {
    await srv.close();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('unknown routes 404', async () => {
  const srv = await startServer({ schema, port: 0 });
  try {
    const res = await fetch(new URL('/nope', srv.url));
    assert.equal(res.status, 404);
  } finally {
    await srv.close();
  }
});

test('close() resolves and the server stops accepting connections', async () => {
  const srv = await startServer({ schema, port: 0 });
  const url = srv.url;
  await srv.close();
  await assert.rejects(fetch(url), 'server should be closed');
});
