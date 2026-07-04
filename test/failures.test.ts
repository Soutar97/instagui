// Story 1.3 — clear, distinct failures. Exit-code routing (0 ok · 2 known · 1 unexpected)
// and message quality. The machinery (typed PreconditionError subclasses + CLI catch)
// exists from 1.1/1.2; these tests lock the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ToolNotFoundError, NoHelpError, PreconditionError } from '../src/core/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli', 'index.ts');

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    input: '', // never read; guards against a stdin hang
    encoding: 'utf8',
    env: { ...process.env, GUIUP_ENGINE: '', ANTHROPIC_API_KEY: '' },
  });
}

// --- Edge (2): distinct friendly strings for tool-not-found vs no-help (assert content) ---
test('tool-not-found and no-help are distinct exit-2 messages', () => {
  const nf = new ToolNotFoundError('widget');
  const nh = new NoHelpError('widget', 'no usable help');

  assert.equal(nf.exitCode, 2);
  assert.equal(nh.exitCode, 2);
  assert.ok(nf instanceof PreconditionError);
  assert.ok(nh instanceof PreconditionError);

  // Right anchors, and NOT overlapping — a reader can tell the two apart.
  assert.match(nf.message, /Tool not found/);
  assert.match(nf.message, /not on your PATH/);
  assert.match(nh.message, /No help output/);
  assert.doesNotMatch(nf.message, /No help output/);
  assert.doesNotMatch(nh.message, /not on your PATH/);
  assert.notEqual(nf.message, nh.message);
});

// --- Expected failure through the real CLI: tool not found → exit 2, friendly, no stack ---
// (NoHelpError shares this exact catch branch, so the exit-2/no-stack process contract holds
//  for it too; its distinct wording is covered by the unit test above.)
test('CLI: unknown tool → exit 2, "Tool not found" on stderr, no stack, empty stdout', () => {
  const r = runCli(['definitely-not-a-real-tool-xyz', '--capture']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), '');
  assert.match(r.stderr, /guiup: Tool not found/);
  assert.doesNotMatch(r.stderr, /unexpected error/);
  assert.doesNotMatch(r.stderr, /\n\s+at /); // no stack frames for an expected failure
});

// --- Edge (1): an unexpected error must NOT be dressed as expected → exit 1, stack, stderr only ---
test('CLI: unexpected error (unreadable --help-file) → exit 1, stack on stderr, empty stdout', () => {
  const r = runCli(['sometool', '--help-file', path.join(here, 'no', 'such', 'file.txt')]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), ''); // nothing friendly on stdout
  assert.match(r.stderr, /unexpected error/);
  assert.match(r.stderr, /\bat /); // a real stack trace is present
  // not mislabeled as a known precondition failure
  assert.doesNotMatch(r.stderr, /Tool not found|No help output/);
});

// --- Success path still exits 0 (help) ---
test('CLI: --help → exit 0', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /guiup <tool>/);
});
