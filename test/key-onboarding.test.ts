// Story 2.4 — key handling + friendly onboarding. The key message appears ONLY when a
// schema truly can't be resolved without it (no override, no cache, no bundled); a
// bundled/cache/override hit is served with no key and no message. Also asserts the
// message is actionable (what/where/how, Windows + POSIX) and exit code 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { apiKeyOnboardingError } from '../src/core/onboarding.js';
import { PreconditionError } from '../src/core/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli', 'index.ts');
const ffmpegHelp = path.join(here, 'fixtures', 'ffmpeg-help.txt');

/** Run the CLI with no API key, no engine selection, and no subscription CLI on PATH, so the
 *  extraction tier would genuinely have no usable engine. PATH is scrubbed (not just unset env
 *  vars) so this is deterministic even on a machine that happens to have `claude`/`codex`/
 *  `gemini` installed (auto-detect would otherwise pick one up and shell out for real). HOME
 *  (and USERPROFILE on Windows) point at a fresh empty temp dir so the child never reads the
 *  real ~/.instagui/config.json. Never reads stdin (guards against a hang). */
function runKeyless(args: string[]) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'instagui-home-'));
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    input: '',
    encoding: 'utf8',
    env: {
      ...process.env,
      INSTAGUI_ENGINE: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      PATH: '',
      HOME: home,
      USERPROFILE: home,
    },
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

// Since Task 9 (multi-engine CLI wiring), the extraction tier resolves an AI *engine* rather
// than requiring ANTHROPIC_API_KEY specifically — so with no flag/env/config default and
// nothing auto-detectable (no keys, no subscription CLI on PATH), the error comes from
// resolveEngineSelection(), not apiKeyOnboardingError() directly. It stays friendly, exit 2,
// names the env vars, and points at `instagui --engines` — the "core meaning" is unchanged.
test('CLI: no engine resolvable (no key, no CLI, no override/cache/bundled) → friendly exit 2, no stack, no API call', () => {
  const r = runKeyless(['zzz-not-a-bundled-tool-xyz', '--help-file', ffmpegHelp]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), ''); // no schema emitted
  assert.match(r.stderr, /API key/i);
  assert.match(r.stderr, /ANTHROPIC_API_KEY/);
  assert.match(r.stderr, /instagui --engines/);
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
