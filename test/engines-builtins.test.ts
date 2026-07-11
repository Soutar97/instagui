import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ENGINES } from '../src/shared/engines/builtins.js';

test('ships the expected built-in engine names', () => {
  assert.deepEqual(
    Object.keys(BUILTIN_ENGINES).sort(),
    ['anthropic', 'claude', 'codex', 'gemini', 'google', 'ollama', 'openai'],
  );
});

test('anthropic built-in preserves today default model + keyEnv', () => {
  const a = BUILTIN_ENGINES.anthropic;
  assert.equal(a.kind, 'anthropic');
  assert.equal(a.model, 'claude-haiku-4-5');
  assert.equal(a.keyEnv, 'ANTHROPIC_API_KEY');
});

test('google built-in uses the Gemini OpenAI-compatible endpoint', () => {
  const g = BUILTIN_ENGINES.google;
  assert.equal(g.kind, 'openai-compatible');
  assert.match(g.baseURL!, /generativelanguage\.googleapis\.com\/v1beta\/openai/);
  assert.equal(g.keyEnv, 'GEMINI_API_KEY');
});

test('claude built-in is a stdin cli engine that maps model aliases', () => {
  const c = BUILTIN_ENGINES.claude;
  assert.equal(c.kind, 'cli');
  assert.equal(c.binary, 'claude');
  assert.deepEqual(c.headlessArgs, ['-p']);
  assert.equal(c.promptVia, 'stdin');
  assert.equal(c.modelMap?.haiku, 'haiku');
});

test('every built-in name matches its map key', () => {
  for (const [k, v] of Object.entries(BUILTIN_ENGINES)) assert.equal(v.name, k);
});
