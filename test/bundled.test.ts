// Story 2.3 — bundled demo schemas. Covers the reader (hit/miss against an injected dir)
// and asserts the SHIPPED schemas/ dir actually contains ffmpeg/yt-dlp/pandoc as valid,
// hallucination-free schemas (the tarball ships them; the keyless demo depends on it).
// (user-cache-wins-over-bundled precedence is pinned in resolve.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundled, bundledDir } from '../src/core/bundled.js';
import { Schema } from '../src/core/schema.js';
import { findHallucinatedFlags } from '../src/core/golden.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

test('readBundled loads a schema from the bundled dir', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'guiup-bundled-'));
  try {
    const schema: Schema = { tool: 'demo', summary: '', options: [], positionals: [] };
    writeFileSync(path.join(dir, 'demo.json'), JSON.stringify(schema), 'utf8');
    assert.deepEqual(readBundled('demo', dir), schema);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundled returns null for a tool that is not bundled', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'guiup-bundled-'));
  try {
    assert.equal(readBundled('not-bundled', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The keyless demo promise: these three must ship and resolve with no key, no API call.
const DEMO_FIXTURES: Record<string, string> = {
  ffmpeg: 'ffmpeg-help.txt',
  'yt-dlp': 'yt-dlp-help.txt',
  pandoc: 'pandoc-help.txt',
};

for (const [tool, fixture] of Object.entries(DEMO_FIXTURES)) {
  test(`shipped schemas/ contains a valid, hallucination-free schema for ${tool}`, () => {
    const schema = readBundled(tool, bundledDir());
    assert.ok(schema, `expected a bundled schema for ${tool} in schemas/`);
    // It parses against the live contract, and its tool name is correct.
    assert.doesNotThrow(() => Schema.parse(schema));
    assert.equal(schema.tool, tool);
    assert.ok(schema.options.length > 0, `${tool} should expose options`);
    // Quality floor: every flag in the bundled schema appears verbatim in the source help.
    const helpText = readFileSync(path.join(fixtures, fixture), 'utf8');
    assert.deepEqual(findHallucinatedFlags(schema, helpText), [], `${tool} has hallucinated flags`);
  });
}
