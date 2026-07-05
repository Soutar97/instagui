// Story 2.1 — user schema cache in ~/.instagui. Covers: write-then-read round-trip
// (first extraction is cached, keyed by tool name), cache miss, and the corrupt-cache
// fall-through contract (never crash — return null so the resolver re-extracts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCache, writeCache, cachePath, toolKey } from '../src/core/cache.js';
import type { Schema } from '../src/core/schema.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'instagui-cache-'));
}

const schema: Schema = {
  tool: 'demo',
  summary: 'a demo tool',
  options: [
    { name: 'verbose', flag: '-v, --verbose', type: 'boolean', description: '', enumValues: [], required: false, group: '' },
  ],
  positionals: [],
};

test('writeCache then readCache round-trips the Schema (keyed by tool name)', () => {
  const dir = tmpDir();
  try {
    const written = writeCache('demo', schema, dir);
    assert.equal(written, cachePath('demo', dir));
    assert.ok(existsSync(written));
    const loaded = readCache('demo', dir);
    assert.deepEqual(loaded, schema);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeCache creates the cache dir when it does not exist', () => {
  const dir = path.join(tmpDir(), 'nested', 'instagui');
  try {
    assert.ok(!existsSync(dir));
    writeCache('demo', schema, dir);
    assert.ok(existsSync(cachePath('demo', dir)));
  } finally {
    rmSync(path.join(dir, '..', '..'), { recursive: true, force: true });
  }
});

test('readCache returns null on a cache miss (no file)', () => {
  const dir = tmpDir();
  try {
    assert.equal(readCache('never-cached', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt (non-JSON) cache file → null, not a throw (falls through to re-extraction)', () => {
  const dir = tmpDir();
  try {
    writeFileSync(cachePath('demo', dir), '{ this is not json', 'utf8');
    assert.doesNotThrow(() => readCache('demo', dir));
    assert.equal(readCache('demo', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid-JSON but wrong-shape cache file → null (fails Schema.parse, falls through)', () => {
  const dir = tmpDir();
  try {
    writeFileSync(cachePath('demo', dir), JSON.stringify({ tool: 'demo', options: 'not-an-array' }), 'utf8');
    assert.equal(readCache('demo', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('toolKey sanitizes path separators so a tool name cannot escape the cache dir', () => {
  assert.equal(toolKey('yt-dlp'), 'yt-dlp');
  assert.equal(toolKey('ffmpeg'), 'ffmpeg');
  assert.doesNotMatch(toolKey('../../etc/passwd'), /[/\\]/);
});
