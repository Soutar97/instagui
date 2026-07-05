// Engine selection. The SDK path (shared/claude.ts `complete`) is primary and the default.
// INSTAGUI_ENGINE=claude-code opts into the dev-only headless-Claude-Code adapter — a test
// harness for running extraction without an API key. Any other value (or unset) → SDK.
import { complete, type CompleteFn } from './claude.js';
import { completeViaClaudeCode } from './claude-code.js';

export const ENGINE_ENV = 'INSTAGUI_ENGINE';

/** Resolve the active completion engine from the environment. */
export function resolveComplete(): CompleteFn {
  if (process.env[ENGINE_ENV] === 'claude-code') return completeViaClaudeCode;
  return complete;
}

/** Human-readable name of the active engine (for diagnostics; never prints secrets). */
export function activeEngineName(): string {
  return process.env[ENGINE_ENV] === 'claude-code' ? 'claude-code (dev)' : 'sdk';
}
