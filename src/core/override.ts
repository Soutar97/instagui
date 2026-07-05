// Story 2.2 — the `--schema <file>` override. A power user supplies their own hand-tuned
// Schema; instagui uses it directly with NO tool-help invocation and NO API call. It sits at
// the top of the resolution precedence (override > cache > bundled > extraction).
//
// Unlike the cache/bundled tiers, a bad override is a user-facing error, not a silent
// fall-through: the user named this file explicitly, so a clear, reason-specific message
// (exit code 2) is the right response.
import { PreconditionError } from './errors.js';
import { readSchemaFile } from './schema-file.js';
import type { Schema } from './schema.js';

/**
 * Load and validate a `--schema` override file. Returns the parsed Schema, or throws a
 * PreconditionError (exit 2) whose message points at exactly what is wrong.
 */
export function loadOverrideSchema(file: string): Schema {
  const result = readSchemaFile(file);
  if (result.ok) return result.schema;

  const messages: Record<typeof result.reason, string> = {
    missing: `--schema file not found: ${file}`,
    unreadable: `--schema file could not be read: ${file} (${result.detail})`,
    'invalid-json': `--schema file is not valid JSON: ${file} (${result.detail})`,
    'invalid-schema': `--schema file does not match the instagui Schema: ${file}\n${result.detail}`,
  };
  throw new PreconditionError(messages[result.reason]);
}
