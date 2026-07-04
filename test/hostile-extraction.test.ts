// Story 1.1 Definition of Done — the three hostile inputs, against the REAL model.
// Gated on ANTHROPIC_API_KEY so `npm test` stays green without a key; run with a key set
// to exercise the DoD (extraction quality, not just plumbing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractSchema } from '../src/core/extract.js';
import { findHallucinatedFlags, flagTokens } from '../src/core/golden.js';
import type { Schema } from '../src/core/schema.js';

// Runs against a real model via either engine: the SDK path (needs ANTHROPIC_API_KEY) or
// the dev-only claude-code adapter (GUIUP_ENGINE=claude-code, subscription auth).
const HAS_KEY = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
const CLAUDE_CODE = process.env.GUIUP_ENGINE === 'claude-code';
const HAS_KEY_OR_ENGINE = HAS_KEY || CLAUDE_CODE;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

function hasAnyFlag(schema: Schema, tokens: string[]): boolean {
  return schema.options.some((o) => flagTokens(o.flag).some((t) => tokens.includes(t)));
}
function optWith(schema: Schema, token: string): Schema['options'][number] | undefined {
  return schema.options.find((o) => flagTokens(o.flag).includes(token));
}
/** ffmpeg uses stream specifiers (-c:v). Treat "-c:v" as grounded when its base "-c"
 *  appears in the help — a documented variant, not a hallucination. */
function hallucinatedIgnoringStreamSpec(schema: Schema, help: string): string[] {
  return findHallucinatedFlags(schema, help).filter((f) => !help.includes(f.split(':')[0]!));
}

test('hostile (a) ffmpeg-scale help → valid Schema, useful options, positionals, no hallucination', {
  skip: !HAS_KEY_OR_ENGINE,
}, async () => {
  const help = fixture('ffmpeg-help.txt');
  assert.ok(help.split('\n').length > 1000, 'fixture really is ffmpeg-scale');
  const { schema } = await extractSchema(help, 'ffmpeg');

  // Extracted a useful set from a huge input (not just one or two).
  assert.ok(schema.options.length >= 8, `expected many options, got ${schema.options.length}`);

  // Money-demo essentials present.
  for (const need of ['-i', '-y', '-b', '-r', '-s']) {
    assert.ok(hasAnyFlag(schema, [need]), `missing ffmpeg option ${need}`);
  }
  assert.ok(hasAnyFlag(schema, ['-c', '-codec', '-vcodec']), 'missing a codec option');

  // -y takes no value → boolean.
  const y = optWith(schema, '-y');
  assert.equal(y?.type, 'boolean', '-y should be boolean');

  // Positionals captured (output file).
  assert.ok(schema.positionals.length >= 1, 'ffmpeg output positional missing');

  // No invented flags (ignoring documented -x:stream specifier variants).
  assert.deepEqual(hallucinatedIgnoringStreamSpec(schema, help), []);

  console.log(`  ffmpeg → ${schema.options.length} options, ${schema.positionals.length} positionals`);
});

test('hostile (b) short-flags-only tool → every short flag captured, none dropped', {
  skip: !HAS_KEY_OR_ENGINE,
}, async () => {
  const help = fixture('shortflags-help.txt');
  const { schema } = await extractSchema(help, 'sq');

  for (const need of ['-x', '-v', '-r', '-o', '-n']) {
    assert.ok(hasAnyFlag(schema, [need]), `short flag ${need} was dropped`);
  }
  assert.equal(optWith(schema, '-x')?.type, 'boolean', '-x should be boolean');
  assert.ok(['path', 'string'].includes(optWith(schema, '-o')?.type ?? ''), '-o should be path/string');
  assert.ok(['number', 'string'].includes(optWith(schema, '-n')?.type ?? ''), '-n should be number/string');

  // No long forms invented, nothing hallucinated.
  assert.deepEqual(findHallucinatedFlags(schema, help), []);

  console.log(`  sq → ${schema.options.map((o) => o.flag).join(', ')}`);
});

test('hostile (c) subcommand-noise flat tool → top-level options only, no subcommand tree', {
  skip: !HAS_KEY_OR_ENGINE,
}, async () => {
  const help = fixture('subcommand-noise-help.txt');
  const { schema } = await extractSchema(help, 'pack');

  // Top-level options captured.
  assert.ok(hasAnyFlag(schema, ['-o', '--output']), 'missing --output');
  assert.ok(hasAnyFlag(schema, ['-f', '--force']), 'missing --force');
  assert.ok(hasAnyFlag(schema, ['-v', '--verbose']), 'missing --verbose');

  // The <file> positional captured.
  assert.ok(schema.positionals.length >= 1, 'missing <file> positional');

  // Did NOT invent a subcommand tree: the example verbs must not become options.
  const invented = schema.options.filter((o) =>
    /^(build|run|ship)$/i.test(o.name) || flagTokens(o.flag).some((t) => /(build|run|ship)/i.test(t)),
  );
  assert.deepEqual(invented, [], 'example verbs were promoted to subcommands/options');

  assert.deepEqual(findHallucinatedFlags(schema, help), []);

  console.log(`  pack → options [${schema.options.map((o) => o.flag).join(', ')}], positionals ${schema.positionals.length}`);
});
