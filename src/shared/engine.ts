// src/shared/engine.ts — engine selection entry point. Resolves which AI engine extraction
// uses (from --engine flag, INSTAGUI_ENGINE, ~/.instagui/config.json, or auto-detect) and
// hands back a CompleteFn. Keeps ENGINE_ENV + a no-arg resolveComplete() for back-compat with
// core/extract.ts's `opts.complete ?? resolveComplete()`.
import type { CompleteFn } from './claude.js';
import { loadEngineConfig } from './engines/config.js';
import { selectEngine, createComplete, type SelectDeps } from './engines/registry.js';

export const ENGINE_ENV = 'INSTAGUI_ENGINE';

export interface EngineSelection {
  engine: string;
  reason: string;
  complete: CompleteFn;
}

/** Resolve the full engine selection. `flag` is the --engine value; env + PATH come via deps
 *  (defaults to the real process env). configDir is injectable for tests. */
export function resolveEngineSelection(
  opts: { flag?: string; configDir?: string } = {}, deps: SelectDeps = {},
): EngineSelection {
  const env = deps.env ?? process.env;
  const config = loadEngineConfig(opts.configDir);
  const { engine, reason } = selectEngine(
    { flag: opts.flag, envName: env[ENGINE_ENV], config }, deps,
  );
  return { engine: engine.name, reason, complete: createComplete(engine, deps) };
}

/** Back-compat: env-only resolution returning just the CompleteFn. */
export function resolveComplete(): CompleteFn {
  return resolveEngineSelection().complete;
}

/** Back-compat diagnostic name. */
export function activeEngineName(): string {
  try {
    return resolveEngineSelection().engine;
  } catch {
    return 'unresolved';
  }
}
