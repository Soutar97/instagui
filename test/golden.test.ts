import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagTokens, findHallucinatedFlags, goldenCheck } from '../src/core/golden.js';
import type { Schema } from '../src/core/schema.js';

function opt(flag: string, type: Schema['options'][number]['type']): Schema['options'][number] {
  return { name: flag, flag, type, description: '', enumValues: [], required: false, group: '' };
}

test('flagTokens splits combined flag forms', () => {
  assert.deepEqual(flagTokens('-c, --codec'), ['-c', '--codec']);
  assert.deepEqual(flagTokens('-c/--codec'), ['-c', '--codec']);
  assert.deepEqual(flagTokens('-x'), ['-x']);
  assert.deepEqual(flagTokens('codec'), []); // no leading dash → not a flag token
});

test('findHallucinatedFlags flags anything absent from help', () => {
  const help = 'Usage: t [-v] [--codec NAME]\n  -v        verbose\n  --codec   codec name\n';
  const schema: Schema = {
    tool: 't',
    summary: '',
    options: [opt('-v', 'boolean'), opt('--codec', 'string'), opt('--invented', 'string')],
    positionals: [],
  };
  assert.deepEqual(findHallucinatedFlags(schema, help), ['--invented']);
});

test('findHallucinatedFlags returns [] when every flag is grounded', () => {
  const help = '  -x extract\n  -o FILE output\n';
  const schema: Schema = {
    tool: 't',
    summary: '',
    options: [opt('-x', 'boolean'), opt('-o', 'path')],
    positionals: [],
  };
  assert.deepEqual(findHallucinatedFlags(schema, help), []);
});

test('goldenCheck reports missing and type-mismatched required options', () => {
  const schema: Schema = {
    tool: 't',
    summary: '',
    options: [opt('-o', 'string'), opt('-v', 'boolean')],
    positionals: [],
  };
  const res = goldenCheck(schema, [
    { flag: '-o', type: 'path' }, // present but wrong type
    { flag: '-v', type: 'boolean' }, // ok
    { flag: '-n', type: 'number' }, // missing
  ]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missing, ['-n']);
  assert.equal(res.typeMismatches.length, 1);
});
