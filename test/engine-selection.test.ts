import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { resolveEngineSelection } from '../src/shared/engine.js';

test('resolveEngineSelection: flag wins and yields a callable complete', () => {
  const sel = resolveEngineSelection(
    { flag: 'ollama', configDir: '/nonexistent-dir-xyz' },
    { env: {}, onPath: () => false },
  );
  assert.equal(sel.engine, 'ollama');
  assert.equal(typeof sel.complete, 'function');
});

test('resolveEngineSelection: env INSTAGUI_ENGINE=claude-code resolves to claude', () => {
  const sel = resolveEngineSelection(
    { configDir: '/nonexistent-dir-xyz' },
    { env: { INSTAGUI_ENGINE: 'claude-code' }, onPath: () => true },
  );
  assert.equal(sel.engine, 'claude');
});

test('resolveEngineSelection: key-only env picks anthropic (today\'s behavior)', () => {
  const sel = resolveEngineSelection(
    { configDir: '/nonexistent-dir-xyz' },
    { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => false },
  );
  assert.equal(sel.engine, 'anthropic');
});

test('an explicit --model override reaches the adapter (not silently dropped)', async () => {
  const sel = resolveEngineSelection(
    { flag: 'anthropic', modelOverride: 'claude-opus-4-8', configDir: '/nonexistent-dir-xyz' },
    { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => false },
  );
  let seenModel = '';
  const fakeClient = { messages: { create: async (b: { model: string }) => { seenModel = b.model; return { content: [{ type: 'text', text: '{"tool":"x"}' }] }; } } };
  const req = { model: 'claude-haiku-4-5', system: 's', user: 'u', outputSchema: z.object({ tool: z.string() }) };
  await sel.complete(req as never, fakeClient as never);
  assert.equal(seenModel, 'claude-opus-4-8'); // NOT the engine/default haiku
});
