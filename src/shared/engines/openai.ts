// src/shared/engines/openai.ts — the openai-compatible engine: any endpoint speaking
// POST /chat/completions (OpenAI, Ollama, Kimi, DeepSeek, Groq, OpenRouter, Together,
// LM Studio, vLLM, Gemini's OpenAI-compat endpoint). fetch is injectable for tests.
//
// Structured output: `response_format` is sent per `structuredOutput`, and the JSON Schema
// is ALWAYS embedded in the user message so schema-poor endpoints still comply. Validation
// stays in core/extract.ts (this returns raw text).
import type { CompletionRequest, CompleteFn } from '../claude.js';
import { PreconditionError } from '../errors.js';
import { jsonSchemaText, schemaInstruction, extractJsonText } from './structured.js';
import type { EngineDescriptor, StructuredMode } from './types.js';

export type FetchLike = typeof fetch;
export interface OpenAIDeps {
  fetchFn?: FetchLike;
  env?: NodeJS.ProcessEnv;
}

/** An engine is keyless when it declares no keyEnv (e.g. local Ollama). */
function keyless(engine: EngineDescriptor): boolean {
  return !engine.keyEnv;
}

/** The key is read only from the environment (via keyEnv) — never from the descriptor/disk. */
function apiKey(engine: EngineDescriptor, env: NodeJS.ProcessEnv): string | undefined {
  return engine.keyEnv ? env[engine.keyEnv] : undefined;
}

export function openaiAvailable(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  if (keyless(engine)) return true;
  const k = apiKey(engine, env);
  return typeof k === 'string' && k.trim().length > 0;
}

export function assertOpenAIReady(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): void {
  if (!openaiAvailable(engine, env)) {
    throw new PreconditionError(
      `Engine "${engine.name}" needs an API key. Set ${engine.keyEnv} for its endpoint (${engine.baseURL}).`,
    );
  }
}

function responseFormat(mode: StructuredMode | undefined, schema: unknown): Record<string, unknown> {
  const m = mode ?? 'auto';
  if (m === 'none') return {};
  if (m === 'json_object') return { response_format: { type: 'json_object' } };
  // auto | json_schema
  return { response_format: { type: 'json_schema', json_schema: { name: 'instagui_schema', schema, strict: true } } };
}

export function createOpenAIComplete(engine: EngineDescriptor, deps: OpenAIDeps = {}): CompleteFn {
  const fetchFn = deps.fetchFn ?? fetch;
  const env = deps.env ?? process.env;

  return async (req: CompletionRequest): Promise<string> => {
    if (!engine.baseURL) throw new PreconditionError(`Engine "${engine.name}" is missing baseURL.`);
    assertOpenAIReady(engine, env);

    const schemaText = jsonSchemaText(req.outputSchema);
    const fmt = JSON.parse(schemaText) as unknown;
    const url = `${engine.baseURL.replace(/\/$/, '')}/chat/completions`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = apiKey(engine, env);
    if (key) headers.authorization = `Bearer ${key}`;

    const body = {
      model: engine.model ?? req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: `${req.user}\n\n${schemaInstruction(schemaText)}` },
      ],
      max_tokens: req.maxTokens ?? 16000,
      ...responseFormat(engine.structuredOutput, fmt),
    };

    let res: Response;
    try {
      res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new PreconditionError(`Request to ${engine.name} (${url}) failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      let detail = (await res.text().catch(() => '')).slice(0, 500);
      if (key) detail = detail.split(key).join('[redacted]');
      throw new PreconditionError(`Engine "${engine.name}" returned HTTP ${res.status} from ${url}. ${detail}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    return extractJsonText(content);
  };
}
