import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { createAnthropicComplete, anthropicAvailable, assertAnthropicReady } from '../src/shared/engines/anthropic.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';
import type { ClaudeClient } from '../src/shared/claude.js';

const eng: EngineDescriptor = { name: 'anthropic', kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5' };
const Demo = z.object({ tool: z.string() });
const req = { model: 'claude-haiku-4-5', system: 's', user: 'u', outputSchema: Demo };

test('createAnthropicComplete sends the engine model and returns the SDK text', async () => {
  let seenModel = '';
  const fake: ClaudeClient = {
    messages: { create: async (body: unknown) => { seenModel = (body as { model: string }).model; return { content: [{ type: 'text', text: '{"tool":"x"}' }] }; } },
  };
  const complete = createAnthropicComplete(eng, fake);
  const out = await complete(req);
  assert.equal(out, '{"tool":"x"}');
  assert.equal(seenModel, 'claude-haiku-4-5');
});

test('anthropicAvailable follows the key env presence', () => {
  assert.equal(anthropicAvailable(eng, { ANTHROPIC_API_KEY: 'sk-x' }), true);
  assert.equal(anthropicAvailable(eng, {}), false);
});

test('assertAnthropicReady throws PreconditionError naming the env var when the key is absent', () => {
  assert.throws(() => assertAnthropicReady(eng, {}), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /ANTHROPIC_API_KEY/);
    return true;
  });
});
