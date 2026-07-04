// Shared schema-file reader used by all three non-extraction resolution tiers
// (Story 2.1 cache, 2.2 --schema override, 2.3 bundled). One place decides how a Schema
// JSON file is read and validated; each caller decides what to do with a failure:
//   • cache / bundled  → treat any failure as "not available", fall through the chain
//   • --schema override → surface the specific reason as a friendly PreconditionError
import { readFileSync } from 'node:fs';
import { Schema } from './schema.js';

/** Why a schema file could not be turned into a valid Schema. `missing` is a plain
 *  absent file (ENOENT); the rest describe a file that exists but is unusable. */
export type SchemaFileFailure = 'missing' | 'unreadable' | 'invalid-json' | 'invalid-schema';

export type SchemaFileResult =
  | { ok: true; schema: Schema }
  | { ok: false; reason: SchemaFileFailure; detail: string };

/**
 * Read and validate a Schema JSON file. Never throws — the outcome is returned so each
 * tier can choose its own failure behavior (silent fall-through vs. a friendly error).
 */
export function readSchemaFile(file: string): SchemaFileResult {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return { ok: false, reason: err.code === 'ENOENT' ? 'missing' : 'unreadable', detail: err.message };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'invalid-json', detail: (e as Error).message };
  }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-schema', detail: parsed.error.message };
  }
  return { ok: true, schema: parsed.data };
}
