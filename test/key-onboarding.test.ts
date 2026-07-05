// Story 2.4 — key handling + friendly onboarding. The key message appears ONLY when a
// schema truly can't be resolved without it (no override, no cache, no bundled); a
// bundled/cache/override hit is served with no key and no message. Also asserts the
// message is actionable (what/where/how, Windows + POSIX) and exit code 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { apiKeyOnboardingError } from '../src/core/onboarding.js';
import { PreconditionError } from '../src/core/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli', 'index.ts');
const ffmpegHelp = path.join(here, 'fixtures', 'ffmpeg-help.txt');

/** Run the CLI with no API key and the default (SDK) engine, so the extraction tier would
 *  genuinely need a key. Never reads stdin (guards against a hang). */
function runKeyless(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, INSTAGUI_ENGINE: '', ANTHROPIC_API_KEY: '' },
  });
}

test('onboarding error: exit 2, actionable, both Windows and POSIX syntax, never the key', () => {
  const err = apiKeyOnboardingError();
  assert.ok(err instanceof PreconditionError);
  assert.equal(err.exitCode, 2);
  assert.match(err.message, /API key/i);
  assert.match(err.message, /console\.anthropic\.com/); // where to get it
  assert.match(err.message, /\$env:ANTHROPIC_API_KEY=/); // Windows / PowerShell
  assert.match(err.message, /export ANTHROPIC_API_KEY=/); // POSIX
  assert.doesNotMatch(err.message, /sk-ant-[A-Za-z0-9]{6,}/); // no real-looking key echoed
});

test('CLI: key missing AND genuinely needed (no override/cache/bundled) → friendly exit 2, no stack, no API call', () => {
  const r = runKeyless(['zzz-not-a-bundled-tool-xyz', '--help-file', ffmpegHelp]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), ''); // no schema emitted
  assert.match(r.stderr, /API key/i);
  assert.match(r.stderr, /export ANTHROPIC_API_KEY=|\$env:ANTHROPIC_API_KEY=/);
  assert.doesNotMatch(r.stderr, /unexpected error/);
  assert.doesNotMatch(r.stderr, /\n\s+at /); // friendly, not a stack
});

// --print keeps resolution testable in isolation: it resolves the Schema and exits (Epic 3
// made serving the default, which would otherwise hold the process open). The resolution
// semantics under test (keyless bundled / override) are unchanged.
test('CLI: a bundled tool resolves with NO key and shows no key message (exit 0)', () => {
  const r = runKeyless(['ffmpeg', '--print']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"tool":\s*"ffmpeg"/);
  assert.doesNotMatch(r.stderr, /API key/i); // resolvable without a key → no onboarding
});

test('CLI: --schema override resolves with NO key and no key message (exit 0)', () => {
  // The bundled ffmpeg schema doubles as a valid override file here.
  const overrideFile = path.join(here, '..', 'schemas', 'ffmpeg.json');
  const r = runKeyless(['anything', '--schema', overrideFile, '--print']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"tool":\s*"ffmpeg"/);
  assert.doesNotMatch(r.stderr, /API key/i);
});
