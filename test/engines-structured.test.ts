import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { jsonSchemaText, schemaInstruction, extractJsonText } from '../src/shared/engines/structured.js';

const Demo = z.object({ tool: z.string(), n: z.number() });

test('jsonSchemaText renders a JSON Schema mentioning the object properties', () => {
  const text = jsonSchemaText(Demo);
  assert.match(text, /"tool"/);
  assert.match(text, /"n"/);
  // valid JSON
  assert.doesNotThrow(() => JSON.parse(text));
});

test('schemaInstruction forbids fences and embeds the schema text', () => {
  const s = schemaInstruction('{"x":1}');
  assert.match(s, /ONLY a single JSON object/i);
  assert.match(s, /no code fences/i);
  assert.match(s, /\{"x":1\}/);
});

test('extractJsonText strips code fences', () => {
  assert.equal(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
});

test('extractJsonText slices the outermost object out of surrounding prose', () => {
  assert.equal(extractJsonText('sure, here:\n{"a":1}\nhope that helps'), '{"a":1}');
});

test('extractJsonText returns the trimmed input when no object is present (lets JSON.parse fail downstream)', () => {
  assert.equal(extractJsonText('  not json  '), 'not json');
});
