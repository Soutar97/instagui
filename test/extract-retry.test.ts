import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractSchema, buildUserPrompt, DEFAULT_MODEL } from '../src/core/extract.js';
import { PreconditionError } from '../src/core/errors.js';

const VALID_JSON = JSON.stringify({ tool: 'demo', summary: '', options: [], positionals: [] });

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'instagui-test-'));
}

test('buildUserPrompt includes the tool name and help text', () => {
  const p = buildUserPrompt('some help', 'ffmpeg');
  assert.match(p, /Tool: ffmpeg/);
  assert.match(p, /some help/);
});

test('default extraction model is claude-haiku-4-5', () => {
  assert.equal(DEFAULT_MODEL, 'claude-haiku-4-5');
});

test('one retry recovers: malformed first, valid second → attempts=2', async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return calls === 1 ? 'not json at all' : VALID_JSON;
  };
  const res = await extractSchema('help', 'demo', { complete: fake });
  assert.equal(calls, 2);
  assert.equal(res.attempts, 2);
  assert.equal(res.schema.tool, 'demo');
});

test('two failures → PreconditionError (exit 2), exactly one retry, debug file written', async () => {
  let calls = 0;
  const bad = '{"tool": 123}'; // valid JSON, wrong shape
  const fake = async () => {
    calls += 1;
    return bad;
  };
  const dir = tmpDir();
  await assert.rejects(
    () => extractSchema('help', 'de/mo', { complete: fake, debugDir: dir, now: 1700000000000 }),
    (err: unknown) => {
      assert.ok(err instanceof PreconditionError);
      assert.equal(err.exitCode, 2);
      assert.ok(err.debugFile, 'debugFile path present');
      // filename sanitized ("/" → "_") and under the given dir
      assert.equal(path.dirname(err.debugFile!), dir);
      assert.match(path.basename(err.debugFile!), /^instagui-debug-de_mo-1700000000000\.json$/);
      const saved = JSON.parse(readFileSync(err.debugFile!, 'utf8'));
      assert.equal(saved.rawOutput, bad); // invalid output preserved, not discarded
      assert.equal(saved.tool, 'de/mo');
      return true;
    },
  );
  assert.equal(calls, 2); // initial + exactly one retry, no third attempt
});

test('invalid JSON (not just wrong shape) also triggers retry then debug file', async () => {
  const fake = async () => '<<<garbage>>>';
  const dir = tmpDir();
  await assert.rejects(
    () => extractSchema('help', 'x', { complete: fake, debugDir: dir, now: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof PreconditionError);
      assert.match(err.message, /not valid JSON|did not match/);
      return true;
    },
  );
});
