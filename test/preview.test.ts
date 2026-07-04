// Story 3.2 — POST /preview returns { args, preview } straight from core/compose.ts, so the
// browser never composes its own command. Because /run composes from the same function over
// the same posted state, the previewed command is exactly what Run executes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server/server.js';
import { compose } from '../src/core/compose.js';
import type { Schema } from '../src/core/schema.js';

const schema: Schema = {
  tool: 'ffmpeg',
  summary: '',
  options: [
    { name: 'overwrite', flag: '-y', type: 'boolean', description: '', enumValues: [], required: false, group: '' },
    { name: 'input', flag: '-i', type: 'path', description: '', enumValues: [], required: false, group: '' },
    { name: 'codec', flag: '-c:v', type: 'string', description: '', enumValues: [], required: false, group: '' },
  ],
  positionals: [{ name: 'outfile', type: 'path', description: '', required: false, variadic: false }],
};

async function postJson(url: URL | string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('POST /preview returns the composed args + preview string for the posted state', async () => {
  const srv = await startServer({ schema, port: 0 });
  try {
    const state = { options: { overwrite: true, input: 'in.mp4', codec: 'libx264' }, positionals: { outfile: 'out.mp4' } };
    const res = await postJson(new URL('/preview', srv.url), state);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { args: string[]; preview: string };

    const expected = compose(schema, state);
    assert.deepEqual(data.args, expected.args);
    assert.equal(data.preview, expected.preview);
    assert.equal(data.preview, 'ffmpeg -y -i in.mp4 -c:v libx264 out.mp4');
  } finally {
    await srv.close();
  }
});

test('POST /preview with empty state yields just the tool name and no args', async () => {
  const srv = await startServer({ schema, port: 0 });
  try {
    const res = await postJson(new URL('/preview', srv.url), {});
    const data = (await res.json()) as { args: string[]; preview: string };
    assert.deepEqual(data.args, []);
    assert.equal(data.preview, 'ffmpeg');
  } finally {
    await srv.close();
  }
});

test('POST /preview needs no Origin (read-only) but rejects malformed JSON with 400', async () => {
  const srv = await startServer({ schema, port: 0 });
  try {
    const ok = await postJson(new URL('/preview', srv.url), { options: {} }); // no Origin header set
    assert.equal(ok.status, 200);

    const bad = await fetch(new URL('/preview', srv.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(bad.status, 400);
  } finally {
    await srv.close();
  }
});
