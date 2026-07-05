// Story 3.1 — the served Form. renderPage maps option types to controls, groups options,
// marks required, gives positionals inputs, and (scope fence) uses plain text for file paths
// — no native picker. Asserted against the HTML string (no DOM needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/server/page.js';
import { CLIENT_SCRIPT } from '../src/server/client.js';
import type { Schema } from '../src/core/schema.js';

const schema: Schema = {
  tool: 'demotool',
  summary: 'a demo tool',
  options: [
    { name: 'verbose', flag: '-v, --verbose', type: 'boolean', description: 'be loud', enumValues: [], required: false, group: 'General' },
    { name: 'format', flag: '-f', type: 'enum', description: 'output format', enumValues: ['json', 'yaml'], required: true, group: 'General' },
    { name: 'threads', flag: '-t', type: 'number', description: 'thread count', enumValues: [], required: false, group: 'Perf' },
    { name: 'name', flag: '--name', type: 'string', description: 'a name', enumValues: [], required: false, group: 'Perf' },
    { name: 'config', flag: '-c', type: 'path', description: 'config file', enumValues: [], required: false, group: 'Perf' },
  ],
  positionals: [
    { name: 'input', type: 'path', description: 'input file', required: true, variadic: false },
    { name: 'extras', type: 'string', description: 'extra items', required: false, variadic: true },
  ],
};

const html = renderPage(schema, CLIENT_SCRIPT);

test('boolean → checkbox, enum → select, number → number input, string/path → text', () => {
  assert.match(html, /type="checkbox"[^>]*data-name="verbose"/);
  assert.match(html, /<select[^>]*data-name="format"[^>]*>/);
  assert.match(html, /<option value="json">json<\/option>/);
  assert.match(html, /<option value="yaml">yaml<\/option>/);
  assert.match(html, /type="number"[^>]*data-name="threads"/);
  assert.match(html, /type="text"[^>]*data-name="name"/);
  assert.match(html, /type="text"[^>]*data-name="config"/); // path is a text field
});

test('scope fence: file paths are plain text — no native file picker anywhere', () => {
  assert.doesNotMatch(html, /type="file"/);
});

test('options are grouped by their group field (legends present)', () => {
  assert.match(html, /<legend>General<\/legend>/);
  assert.match(html, /<legend>Perf<\/legend>/);
});

test('required options are marked', () => {
  // The required enum "format" carries a required marker; the optional ones do not force it.
  assert.match(html, /data-name="format"[^>]*data-required="true"/);
});

test('positionals get inputs (the money demo needs input/output files)', () => {
  assert.match(html, /data-kind="positional"[^>]*data-name="input"/);
  assert.match(html, /data-kind="positional"[^>]*data-name="extras"/);
  assert.match(html, /<legend>Arguments<\/legend>/);
});

test('the Schema is embedded for the client and the tool name titles the page', () => {
  assert.match(html, /<script type="application\/json" id="schema">/);
  assert.match(html, /"tool":"demotool"/);
  assert.match(html, /<title>instagui — demotool<\/title>/);
});

test('embedded JSON cannot break out of the script tag', () => {
  const hostile: Schema = {
    tool: 'x</script><script>alert(1)</script>',
    summary: '',
    options: [],
    positionals: [],
  };
  const out = renderPage(hostile, CLIENT_SCRIPT);
  // The raw closing tag from tool data must be neutralised in both the JSON and the title.
  assert.doesNotMatch(out, /<script>alert\(1\)<\/script>/);
});
