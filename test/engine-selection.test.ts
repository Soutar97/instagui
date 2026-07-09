import { test } from 'node:test';
import assert from 'node:assert/strict';
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
