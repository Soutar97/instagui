// The resolution precedence — the through-line of Epic 2. A Schema is found without
// re-paying, in this exact order:
//
//   --schema override  >  user cache (~/.guiup)  >  bundled schemas  >  fresh extraction
//
// Only the extraction tier captures help or calls the AI; the first three are free and
// keyless. A fresh extraction is written back to the user cache so the next run is free.
//
// This module is pure orchestration: every tier is an injected dependency so the
// precedence can be tested exhaustively with fakes, and the CLI supplies the real ones.
import type { Schema } from './schema.js';

export type SchemaSource = 'override' | 'cache' | 'bundled' | 'extraction';

export interface ResolveInput {
  tool: string;
  /** Path from `--schema <file>`; when set, wins over everything. */
  schemaFile?: string;
  /** `--refresh`: skip cache AND bundled, force a fresh extraction, re-cache the result. */
  refresh: boolean;
}

export interface ResolveDeps {
  /** Load a `--schema` override; throws a PreconditionError with a clear reason on a bad
   *  file (missing / non-JSON / fails Schema.parse). */
  loadOverride: (file: string) => Schema;
  /** User-cache read; null on miss or corrupt entry (falls through). */
  readCache: (tool: string) => Schema | null;
  /** Bundled read-only read; null when the tool isn't bundled. */
  readBundled: (tool: string) => Schema | null;
  /** Capture help + call the AI. Only invoked when no cheaper tier resolved. */
  extract: () => Promise<Schema>;
  /** Persist a freshly extracted Schema to the user cache; returns the path written. */
  writeCache: (tool: string, schema: Schema) => string;
}

export interface ResolveResult {
  schema: Schema;
  source: SchemaSource;
  /** Where a freshly extracted Schema was cached (extraction source only). */
  cachedTo?: string;
}

/**
 * Resolve a Schema for `input.tool` by the fixed precedence above. `--schema` short-circuits
 * before any capture or cache read; `--refresh` skips the two free lookup tiers so the
 * result comes from a fresh extraction and overwrites the user cache.
 */
export async function resolveSchema(input: ResolveInput, deps: ResolveDeps): Promise<ResolveResult> {
  if (input.schemaFile) {
    return { schema: deps.loadOverride(input.schemaFile), source: 'override' };
  }

  if (!input.refresh) {
    const cached = deps.readCache(input.tool);
    if (cached) return { schema: cached, source: 'cache' };

    const bundled = deps.readBundled(input.tool);
    if (bundled) return { schema: bundled, source: 'bundled' };
  }

  const schema = await deps.extract();
  const cachedTo = deps.writeCache(input.tool, schema);
  return { schema, source: 'extraction', cachedTo };
}
