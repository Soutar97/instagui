// src/shared/claude-code.ts — retained for back-compat. The subscription-CLI logic now lives
// in engines/cli.ts; this re-exports the pieces older import sites referenced.
import { BUILTIN_ENGINES } from './engines/builtins.js';
import { createCliComplete } from './engines/cli.js';
import type { CompleteFn } from './claude.js';

export { extractJsonText } from './engines/structured.js';

/** The `claude -p` completion, now the built-in `claude` CLI engine. Dev/test convenience.
 *  Non-null assertion: `claude` is always present in BUILTIN_ENGINES (registered in code, not
 *  user-configurable away) — `noUncheckedIndexedAccess` otherwise widens the index access. */
export const completeViaClaudeCode: CompleteFn = createCliComplete(BUILTIN_ENGINES.claude!);
