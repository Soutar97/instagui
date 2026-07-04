// Epic 2 through-line — resolution precedence:
//   --schema override > user cache > bundled > fresh extraction
// Exercised with fakes for every tier so the ordering, the short-circuits (no capture/API
// on a cheaper hit), and the --refresh bypass are all pinned independent of I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchema, type ResolveDeps } from '../src/core/resolve.js';
import type { Schema } from '../src/core/schema.js';

function schemaNamed(tool: string): Schema {
  return { tool, summary: '', options: [], positionals: [] };
}

/** Build deps whose call counts are tracked centrally, so a test only configures what each
 *  lookup RETURNS (null = miss, a Schema = hit) without losing the counter. Defaults: all
 *  lookups miss, extraction yields a Schema named "extracted". */
interface DepReturns {
  cache?: Schema | null;
  bundled?: Schema | null;
  override?: Schema;
}
function makeDeps(ret: DepReturns = {}) {
  const calls = { loadOverride: 0, readCache: 0, readBundled: 0, extract: 0, writeCache: 0 };
  const deps: ResolveDeps = {
    loadOverride: (f) => { calls.loadOverride++; return ret.override ?? schemaNamed(`override:${f}`); },
    readCache: () => { calls.readCache++; return ret.cache ?? null; },
    readBundled: () => { calls.readBundled++; return ret.bundled ?? null; },
    extract: async () => { calls.extract++; return schemaNamed('extracted'); },
    writeCache: () => { calls.writeCache++; return '/cache/path.json'; },
  };
  return { deps, calls };
}

test('--schema override wins over cache, bundled, and extraction', async () => {
  const { deps, calls } = makeDeps({
    cache: schemaNamed('cache'),
    bundled: schemaNamed('bundled'),
  });
  const r = await resolveSchema({ tool: 'demo', schemaFile: 'my.json', refresh: false }, deps);
  assert.equal(r.source, 'override');
  assert.equal(r.schema.tool, 'override:my.json');
  // No cheaper tier is even consulted — no capture, no API.
  assert.deepEqual(calls, { loadOverride: 1, readCache: 0, readBundled: 0, extract: 0, writeCache: 0 });
});

test('cache hit wins over bundled and extraction (zero capture, zero API)', async () => {
  const { deps, calls } = makeDeps({
    cache: schemaNamed('cache'),
    bundled: schemaNamed('bundled'),
  });
  const r = await resolveSchema({ tool: 'demo', refresh: false }, deps);
  assert.equal(r.source, 'cache');
  assert.equal(r.schema.tool, 'cache');
  assert.equal(calls.readBundled, 0);
  assert.equal(calls.extract, 0);
  assert.equal(calls.writeCache, 0);
});

test('cache miss + bundled hit → bundled, no extraction', async () => {
  const { deps, calls } = makeDeps({
    bundled: schemaNamed('bundled'),
  });
  const r = await resolveSchema({ tool: 'ffmpeg', refresh: false }, deps);
  assert.equal(r.source, 'bundled');
  assert.equal(calls.readCache, 1);
  assert.equal(calls.readBundled, 1);
  assert.equal(calls.extract, 0);
});

test('all lookups miss → extraction, and the result is written to the user cache', async () => {
  const { deps, calls } = makeDeps();
  const r = await resolveSchema({ tool: 'demo', refresh: false }, deps);
  assert.equal(r.source, 'extraction');
  assert.equal(r.schema.tool, 'extracted');
  assert.equal(r.cachedTo, '/cache/path.json');
  assert.deepEqual(calls, { loadOverride: 0, readCache: 1, readBundled: 1, extract: 1, writeCache: 1 });
});

test('--refresh bypasses cache AND bundled, re-extracts, and overwrites the user cache', async () => {
  const { deps, calls } = makeDeps({
    cache: schemaNamed('cache'),   // would hit, but must be skipped
    bundled: schemaNamed('bundled'), // would hit, but must be skipped
  });
  const r = await resolveSchema({ tool: 'ffmpeg', refresh: true }, deps);
  assert.equal(r.source, 'extraction');
  assert.equal(calls.readCache, 0);
  assert.equal(calls.readBundled, 0);
  assert.equal(calls.extract, 1);
  assert.equal(calls.writeCache, 1); // re-cached; writeCache targets ~/.guiup, never bundled
});

test('corrupt cache (readCache→null) falls through to bundled', async () => {
  const { deps } = makeDeps({
    cache: null, // simulates a corrupt/invalid cache entry
    bundled: schemaNamed('bundled'),
  });
  const r = await resolveSchema({ tool: 'demo', refresh: false }, deps);
  assert.equal(r.source, 'bundled');
});
