// Story 2.2 — `--schema <file>` override loading + validation messaging.
// (Precedence over cache/bundled/extraction is pinned in resolve.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOverrideSchema } from '../src/core/override.js';
import { PreconditionError } from '../src/core/errors.js';
import type { Schema } from '../src/core/schema.js';

/** Run `fn`, asserting it throws a PreconditionError, and return that error for further
 *  assertions (assert.throws itself returns undefined). */
function catchPrecondition(fn: () => unknown): PreconditionError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PreconditionError, `expected PreconditionError, got ${String(e)}`);
    return e;
  }
  throw new assert.AssertionError({ message: 'expected the call to throw, but it did not' });
}

function tmpFile(name: string, contents: string): { file: string; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'instagui-override-'));
  const file = path.join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return { file, dir };
}

const valid: Schema = {
  tool: 'mytool',
  summary: 'hand-tuned',
  options: [
    { name: 'out', flag: '-o, --output', type: 'path', description: 'output', enumValues: [], required: true, group: '' },
  ],
  positionals: [{ name: 'input', type: 'path', description: 'input', required: true, variadic: false }],
};

test('a valid override file loads and parses to the Schema', () => {
  const { file, dir } = tmpFile('schema.json', JSON.stringify(valid));
  try {
    const loaded = loadOverrideSchema(file);
    assert.deepEqual(loaded, valid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an override that fails Schema.parse → PreconditionError (exit 2) naming what is wrong', () => {
  const bad = { tool: 'mytool', summary: '', options: [{ name: 'x', flag: '-x', type: 'checkbox' }] };
  const { file, dir } = tmpFile('bad.json', JSON.stringify(bad));
  try {
    const err = catchPrecondition(() => loadOverrideSchema(file));
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /does not match the instagui Schema/);
    assert.match(err.message, new RegExp(file.replace(/[\\.]/g, '\\$&')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an override that is not valid JSON → PreconditionError (exit 2), clear message', () => {
  const { file, dir } = tmpFile('notjson.json', '{ not: json ]');
  try {
    const err = catchPrecondition(() => loadOverrideSchema(file));
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing override file → PreconditionError (exit 2), not a raw crash', () => {
  const err = catchPrecondition(() =>
    loadOverrideSchema(path.join(os.tmpdir(), 'instagui-nope', 'missing.json')),
  );
  assert.equal(err.exitCode, 2);
  assert.match(err.message, /not found/);
});
