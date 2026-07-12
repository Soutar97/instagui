// src/shared/engines/registry.ts — the one place that knows all engines: merges built-ins
// with user config, resolves a name, auto-detects, applies selection precedence, and
// dispatches an EngineDescriptor to the right adapter's CompleteFn.
import { PreconditionError } from '../errors.js';
import type { CompleteFn } from '../claude.js';
import type { EngineDescriptor } from './types.js';
import type { EngineConfig } from './config.js';
import { BUILTIN_ENGINES } from './builtins.js';
import { createAnthropicComplete, anthropicAvailable, assertAnthropicReady } from './anthropic.js';
import { createOpenAIComplete, openaiAvailable, assertOpenAIReady } from './openai.js';
import { createCliComplete, cliAvailable, assertCliReady } from './cli.js';

export interface SelectDeps {
  onPath?: (binary: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

/** Auto-detect order (design §6). */
const API_DETECT_ORDER = ['anthropic', 'openai', 'google', 'deepseek'];
const CLI_DETECT_ORDER = ['claude', 'codex', 'gemini'];

export function buildRegistry(config: EngineConfig): Record<string, EngineDescriptor> {
  const reg: Record<string, EngineDescriptor> = {};
  for (const [name, e] of Object.entries(BUILTIN_ENGINES)) reg[name] = { ...e, name };
  for (const [name, e] of Object.entries(config.engines)) reg[name] = { ...(reg[name] ?? {}), ...e, name };
  return reg;
}

export function resolveEngine(name: string, registry: Record<string, EngineDescriptor>): EngineDescriptor {
  const engine = registry[name];
  if (!engine) {
    const available = Object.keys(registry).sort().join(', ');
    throw new PreconditionError(`Unknown engine "${name}". Available engines: ${available}.`);
  }
  return engine;
}

export function engineAvailable(engine: EngineDescriptor, deps: SelectDeps = {}): boolean {
  const env = deps.env ?? process.env;
  if (engine.kind === 'anthropic') return anthropicAvailable(engine, env);
  if (engine.kind === 'openai-compatible') return openaiAvailable(engine, env);
  if (engine.kind === 'cli') return cliAvailable(engine, { onPath: deps.onPath });
  return false;
}

export function autodetect(
  registry: Record<string, EngineDescriptor>, deps: SelectDeps = {},
): { engine: EngineDescriptor; reason: string } | null {
  for (const name of API_DETECT_ORDER) {
    const e = registry[name];
    if (e && engineAvailable(e, deps)) return { engine: e, reason: `auto-detected: ${e.keyEnv ?? 'api key'}` };
  }
  for (const name of CLI_DETECT_ORDER) {
    const e = registry[name];
    if (e && engineAvailable(e, deps)) return { engine: e, reason: `auto-detected: ${e.binary} CLI on PATH` };
  }
  return null;
}

/** Selection precedence (design §5). `envName` accepts the back-compat alias "claude-code". */
export function selectEngine(
  opts: { flag?: string; envName?: string; config: EngineConfig }, deps: SelectDeps = {},
): { engine: EngineDescriptor; reason: string } {
  const registry = buildRegistry(opts.config);

  if (opts.flag) return { engine: resolveEngine(opts.flag, registry), reason: 'selected by --engine' };

  if (opts.envName) {
    const name = opts.envName === 'claude-code' ? 'claude' : opts.envName;
    return { engine: resolveEngine(name, registry), reason: 'selected by INSTAGUI_ENGINE' };
  }

  if (opts.config.default) return { engine: resolveEngine(opts.config.default, registry), reason: 'config default' };

  const detected = autodetect(registry, deps);
  if (detected) return detected;

  throw new PreconditionError(
    `No AI engine is configured. Set an API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY), ` +
      `log into a CLI (claude/codex/gemini), or add one to ~/.instagui/config.json. Run "instagui --engines" to see options.`,
  );
}

/** Dispatch a resolved engine to its adapter, asserting readiness first. */
export function createComplete(engine: EngineDescriptor, deps: SelectDeps = {}): CompleteFn {
  const env = deps.env ?? process.env;
  if (engine.kind === 'anthropic') { assertAnthropicReady(engine, env); return createAnthropicComplete(engine); }
  if (engine.kind === 'openai-compatible') { assertOpenAIReady(engine, env); return createOpenAIComplete(engine, { env }); }
  if (engine.kind === 'cli') { assertCliReady(engine, { onPath: deps.onPath }); return createCliComplete(engine, { onPath: deps.onPath }); }
  throw new PreconditionError(`Engine "${engine.name}" has an unsupported kind "${engine.kind}".`);
}

/** Human-readable readiness reason for the `--engines` listing. States *why* an engine is or
 *  isn't ready — the env var and whether it's set, or the CLI binary and whether it's on PATH —
 *  without ever printing a key value. */
function engineDetail(e: EngineDescriptor, available: boolean): string {
  if (e.kind === 'cli') return `${e.binary} CLI — ${available ? 'found on PATH' : 'not found on PATH'}`;
  if (!e.keyEnv) return `local endpoint (${e.baseURL}) — no key needed`;
  return `${e.keyEnv}: ${available ? 'set' : 'not set'}`;
}

export function describeEngines(
  registry: Record<string, EngineDescriptor>, deps: SelectDeps = {},
): Array<{ name: string; kind: string; available: boolean; detail: string }> {
  return Object.values(registry).map((e) => {
    const available = engineAvailable(e, deps);
    return { name: e.name, kind: e.kind, available, detail: engineDetail(e, available) };
  });
}
