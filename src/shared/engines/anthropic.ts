// src/shared/engines/anthropic.ts — the Anthropic SDK engine (today's primary path), wrapped
// as an EngineDescriptor adapter. Delegates to shared/claude.ts `complete` for the actual call
// (server-enforced structured output via zodOutputFormat).
import { complete, type CompletionRequest, type CompleteFn, type ClaudeClient } from '../claude.js';
import { PreconditionError } from '../errors.js';
import type { EngineDescriptor } from './types.js';

function keyName(engine: EngineDescriptor): string {
  return engine.keyEnv ?? 'ANTHROPIC_API_KEY';
}

export function anthropicAvailable(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  if (engine.key) return true;
  const v = env[keyName(engine)];
  return typeof v === 'string' && v.trim().length > 0;
}

export function assertAnthropicReady(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): void {
  if (!anthropicAvailable(engine, env)) {
    throw new PreconditionError(
      `Engine "${engine.name}" needs an Anthropic API key. Set ${keyName(engine)} ` +
        `(https://console.anthropic.com/settings/keys), or pick a subscription CLI with --engine claude.`,
    );
  }
}

/** Build a CompleteFn that calls the Anthropic SDK with the engine's model. */
export function createAnthropicComplete(engine: EngineDescriptor, client?: ClaudeClient): CompleteFn {
  return (req: CompletionRequest, injected?: ClaudeClient) => {
    const model = engine.model ?? req.model;
    return complete({ ...req, model }, injected ?? client);
  };
}
