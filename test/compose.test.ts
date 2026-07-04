// Story 3.2 — core/compose.ts. The single source of truth for the arg array. Empty/default
// fields contribute nothing; booleans emit the bare flag; values pass verbatim (a value with
// spaces / quotes / ; / && is ONE argument, no shell meaning); Schema order is preserved,
// positionals last. previewString renders the SAME array so preview == what Run executes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeArgs, previewString, compose, firstFlag } from '../src/core/compose.js';
import type { Schema } from '../src/core/schema.js';

const schema: Schema = {
  tool: 'demotool',
  summary: '',
  options: [
    { name: 'verbose', flag: '-v, --verbose', type: 'boolean', description: '', enumValues: [], required: false, group: '' },
    { name: 'format', flag: '-f/--format', type: 'enum', description: '', enumValues: ['json', 'yaml'], required: false, group: '' },
    { name: 'threads', flag: '-t', type: 'number', description: '', enumValues: [], required: false, group: '' },
    { name: 'name', flag: '--name', type: 'string', description: '', enumValues: [], required: false, group: '' },
    { name: 'config', flag: '-c', type: 'path', description: '', enumValues: [], required: false, group: '' },
  ],
  positionals: [
    { name: 'input', type: 'path', description: '', required: true, variadic: false },
    { name: 'output', type: 'path', description: '', required: false, variadic: false },
  ],
};

test('firstFlag picks the first listed flag token', () => {
  assert.equal(firstFlag('-v, --verbose'), '-v');
  assert.equal(firstFlag('--name'), '--name');
  assert.equal(firstFlag('-f/--format'), '-f');
  assert.equal(firstFlag('-codec'), '-codec');
});

test('empty / default fields contribute no arguments', () => {
  assert.deepEqual(composeArgs(schema, {}), []);
  assert.deepEqual(
    composeArgs(schema, { options: { verbose: false, name: '', threads: '' }, positionals: { input: '' } }),
    [],
  );
});

test('boolean true emits the bare flag; false/absent emits nothing', () => {
  assert.deepEqual(composeArgs(schema, { options: { verbose: true } }), ['-v']);
  assert.deepEqual(composeArgs(schema, { options: { verbose: false } }), []);
  // The string "true" (as some form serializations produce) also counts as checked.
  assert.deepEqual(composeArgs(schema, { options: { verbose: 'true' } }), ['-v']);
});

test('value options emit flag + value; enum, number, string, path all flow through', () => {
  const args = composeArgs(schema, {
    options: { format: 'json', threads: '4', name: 'hi', config: '/etc/app.conf' },
  });
  assert.deepEqual(args, ['-f', 'json', '-t', '4', '--name', 'hi', '-c', '/etc/app.conf']);
});

test('Schema order preserved; positionals come after options', () => {
  const args = composeArgs(schema, {
    options: { verbose: true, name: 'x' },
    positionals: { input: 'in.txt', output: 'out.txt' },
  });
  assert.deepEqual(args, ['-v', '--name', 'x', 'in.txt', 'out.txt']);
});

test('values with spaces / quotes / ; / && pass verbatim as a SINGLE argument each', () => {
  const nasty = 'a b; rm -rf / && echo "pwned"';
  const args = composeArgs(schema, { options: { name: nasty }, positionals: { input: 'x y.txt' } });
  // Exactly two args carried, each intact — no splitting, no shell tokens.
  assert.deepEqual(args, ['--name', nasty, 'x y.txt']);
});

test('previewString renders the SAME array Run would execute (single source)', () => {
  const state = { options: { verbose: true, name: 'a b' }, positionals: { input: 'in file.txt' } };
  const args = composeArgs(schema, state);
  const viaCompose = compose(schema, state);
  assert.deepEqual(viaCompose.args, args);
  assert.equal(viaCompose.preview, previewString(schema.tool, args));
  // Illustrative quoting for readability, derived from the array (not re-parsed for Run).
  assert.equal(viaCompose.preview, "demotool -v --name 'a b' 'in file.txt'");
});

test('unknown/extra state keys are ignored (defensive against untrusted body)', () => {
  const args = composeArgs(schema, {
    options: { verbose: true, bogus: 'ignored' },
    positionals: { nope: 'ignored' },
  });
  assert.deepEqual(args, ['-v']);
});
