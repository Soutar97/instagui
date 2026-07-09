import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { createOpenAIComplete, openaiAvailable, assertOpenAIReady } from '../src/shared/engines/openai.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';

const Demo = z.object({ tool: z.string() });
const req = { model: 'gpt-4o-mini', system: 'sys', user: 'usr', outputSchema: Demo };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const openai: EngineDescriptor = {
  name: 'openai', kind: 'openai-compatible', baseURL: 'https://api.openai.com/v1',
  keyEnv: 'OPENAI_API_KEY', model: 'gpt-4o-mini', structuredOutput: 'auto',
};

test('posts to <baseURL>/chat/completions with bearer auth, engine model, embedded schema, and json_schema format', async () => {
  let url = ''; let init: RequestInit = {};
  const fetchFn = (async (u: string, i: RequestInit) => {
    url = u; init = i;
    return jsonResponse({ choices: [{ message: { content: '{"tool":"ok"}' } }] });
  }) as unknown as typeof fetch;

  const complete = createOpenAIComplete(openai, { fetchFn, env: { OPENAI_API_KEY: 'sk-xyz' } });
  const out = await complete(req);

  assert.equal(out, '{"tool":"ok"}');
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer sk-xyz');
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.response_format.type, 'json_schema');
  // schema embedded in the user message (universal floor)
  const userMsg = (body.messages as Array<Record<string, unknown>>).find((m) => m.role === 'user')?.content;
  assert.match(String(userMsg), /JSON Schema:/);
});

test('local endpoints need no key; json_object mode omits json_schema', async () => {
  const ollama: EngineDescriptor = { name: 'ollama', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', structuredOutput: 'json_object' };
  let body: Record<string, unknown>;
  const fetchFn = (async (_u: string, i: RequestInit) => { body = JSON.parse(String(i.body)) as Record<string, unknown>; return jsonResponse({ choices: [{ message: { content: '{"tool":"z"}' } }] }); }) as unknown as typeof fetch;
  const out = await createOpenAIComplete(ollama, { fetchFn, env: {} })(req);
  assert.equal(out, '{"tool":"z"}');
  assert.equal(body.response_format?.type, 'json_object');
});

test('non-2xx response → PreconditionError with status, no secret leak', async () => {
  const fetchFn = (async () => jsonResponse({ error: 'nope' }, 401)) as unknown as typeof fetch;
  await assert.rejects(
    () => createOpenAIComplete(openai, { fetchFn, env: { OPENAI_API_KEY: 'sk-secret' } })(req),
    (e: unknown) => {
      assert.ok(e instanceof PreconditionError);
      assert.match(e.message, /401/);
      assert.doesNotMatch(e.message, /sk-secret/);
      return true;
    },
  );
});

test('availability + readiness follow key presence (local baseURL is always ready)', () => {
  assert.equal(openaiAvailable(openai, { OPENAI_API_KEY: 'x' }), true);
  assert.equal(openaiAvailable(openai, {}), false);
  const ollama: EngineDescriptor = { name: 'ollama', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1' };
  assert.equal(openaiAvailable(ollama, {}), true); // no keyEnv → treated as keyless/local
  assert.throws(() => assertOpenAIReady(openai, {}), (e) => e instanceof PreconditionError);
});
