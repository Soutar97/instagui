// core/compose.ts — Story 3.2. THE single source of truth for turning form state into the
// argument array. Both the live preview (POST /preview) and execution (POST /run) call this
// exact function, so the preview is guaranteed identical to what Run executes — the
// divergence trap (client composes one thing, server runs another) is closed by construction
// (AC 3.2 / AC 3.3).
//
// Output is an arguments ARRAY, never a shell string: values pass verbatim to spawn, so a
// value containing spaces, quotes, `;`, or `&&` is a single argument with no shell meaning
// (FR-8 / AD-6). previewString() renders that same array as a human-readable command; its
// quoting is illustrative only — Run never re-parses the string, it uses the array.
import type { Schema, Option } from './schema.js';

/** Untrusted form state as posted by the browser. Values are coerced defensively. */
export interface ComposeState {
  options?: Record<string, unknown>;
  positionals?: Record<string, unknown>;
}

/** Pick the canonical flag token from a help-style flag field, e.g.
 *  "-c, --codec" → "-c", "--output" → "--output", "-c/--codec" → "-c". First listed wins
 *  (that is what the tool's help shows first). */
export function firstFlag(flag: string): string {
  const tokens = flag.split(/[\s,|/]+/).filter((t) => t.length > 0);
  const dashed = tokens.find((t) => t.startsWith('-'));
  return dashed ?? tokens[0] ?? flag;
}

/** Non-empty string value → contributes an argument. Empty string / undefined / null → not.
 *  (Booleans are handled separately.) */
function asValue(v: unknown): string | null {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  const s = typeof v === 'string' ? v : String(v);
  return s.length === 0 ? null : s;
}

function pushOption(args: string[], o: Option, raw: unknown): void {
  if (o.type === 'boolean') {
    // A checked box contributes the bare flag; unchecked/absent contributes nothing.
    if (raw === true || raw === 'true') args.push(firstFlag(o.flag));
    return;
  }
  const value = asValue(raw);
  if (value === null) return; // empty/default → no argument
  args.push(firstFlag(o.flag), value);
}

/**
 * Compose the argument array (excluding the tool name) from `state`, honoring Schema order:
 * options first, then positionals. Empty/default fields contribute nothing.
 */
export function composeArgs(schema: Schema, state: ComposeState): string[] {
  const args: string[] = [];
  const options = state.options ?? {};
  const positionals = state.positionals ?? {};

  for (const o of schema.options) {
    pushOption(args, o, options[o.name]);
  }
  for (const p of schema.positionals) {
    const value = asValue(positionals[p.name]);
    if (value !== null) args.push(value);
  }
  return args;
}

/** Wrap an argument for display only when it contains characters that would be ambiguous
 *  unquoted. POSIX single-quote style; purely illustrative (Run uses the array, not this). */
function quoteForDisplay(arg: string): string {
  if (arg === '') return "''";
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Render the composed command as a readable string: `tool arg1 arg2 …`. Derived from the
 *  SAME array `composeArgs` returns, so preview never drifts from execution. */
export function previewString(tool: string, args: string[]): string {
  return [tool, ...args.map(quoteForDisplay)].join(' ');
}

/** Convenience: the arg array and its preview string in one call, from one composition. */
export function compose(schema: Schema, state: ComposeState): { args: string[]; preview: string } {
  const args = composeArgs(schema, state);
  return { args, preview: previewString(schema.tool, args) };
}
