import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '../src/core/schema.js';

const valid = {
  tool: 'demo',
  summary: 'a demo tool',
  options: [
    {
      name: 'verbose',
      flag: '-v, --verbose',
      type: 'boolean',
      description: 'print more',
      enumValues: [],
      required: false,
      group: '',
    },
  ],
  positionals: [
    { name: 'file', type: 'path', description: 'input file', required: true, variadic: false },
  ],
};

test('Schema.parse accepts a well-formed schema', () => {
  const parsed = Schema.parse(valid);
  assert.equal(parsed.tool, 'demo');
  assert.equal(parsed.options[0]?.type, 'boolean');
  assert.equal(parsed.positionals[0]?.variadic, false);
});

test('Schema.parse rejects a bad option type', () => {
  const bad = structuredClone(valid);
  (bad.options[0] as { type: string }).type = 'checkbox';
  assert.throws(() => Schema.parse(bad));
});

test('Schema.parse rejects a missing required field', () => {
  const bad = structuredClone(valid) as Record<string, unknown>;
  delete bad.positionals;
  assert.throws(() => Schema.parse(bad));
});
