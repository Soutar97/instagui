// Pre-launch — instagui's own --version / --help must be exemplary (we parse everyone else's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildRegistry, describeEngines } from '../src/shared/engines/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli', 'index.ts');
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string };

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, INSTAGUI_ENGINE: '', ANTHROPIC_API_KEY: '' },
  });
}

test('--version prints the package version and exits 0', () => {
  const r = runCli(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/); // looks like a real semver
});

test('-v is an alias for --version', () => {
  const r = runCli(['-v']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('--help exits 0 and documents usage, key options, and examples', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /instagui <tool>/);
  assert.match(r.stdout, /--version/);
  assert.match(r.stdout, /Examples:/);
  assert.match(r.stdout, /127\.0\.0\.1 only/); // the security posture is surfaced in help
});

test('no arguments prints usage and exits 2 (nothing to do)', () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Usage:/);
});

test('describeEngines includes anthropic + a cli + an openai-compatible engine', () => {
  const rows = describeEngines(buildRegistry({ engines: {} }), { env: {}, onPath: () => false });
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('anthropic'));
  assert.ok(names.includes('claude'));
  assert.ok(names.includes('openai'));
});
