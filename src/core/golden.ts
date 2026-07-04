// Quality floor (FR-3): a Schema can be valid JSON yet still a failed extraction.
// Two checks live here, both pure and testable:
//   • findHallucinatedFlags — every flag in the Schema must literally appear in the help
//   • goldenCheck           — the options a demo task needs are present, correct flag+type
import type { OptionType, Schema } from './schema.js';

/** Pull the individual flag tokens out of a `flag` field like "-c, --codec" or
 *  "-c/--codec" → ["-c", "--codec"]. Only tokens that start with "-" count. */
export function flagTokens(flag: string): string[] {
  return flag
    .split(/[\s,/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('-'));
}

/**
 * Return every flag token in the Schema that does NOT appear verbatim in the help text.
 * A non-empty result means the model invented flags — a hallucination, and a failed
 * extraction regardless of JSON validity.
 */
export function findHallucinatedFlags(schema: Schema, helpText: string): string[] {
  const hallucinated: string[] = [];
  for (const opt of schema.options) {
    for (const token of flagTokens(opt.flag)) {
      if (!helpText.includes(token)) hallucinated.push(token);
    }
  }
  return [...new Set(hallucinated)];
}

export interface RequiredOption {
  /** A flag token the option must expose, e.g. "-c" or "--codec". Matched against any of
   *  the option's flag tokens. */
  flag: string;
  /** The type the option must have. */
  type: OptionType;
}

export interface GoldenResult {
  ok: boolean;
  /** Required flags with no matching option in the Schema. */
  missing: string[];
  /** Required flags present but with the wrong type (`flag: expected≠actual`). */
  typeMismatches: string[];
}

/**
 * Verify that every option a demo task needs is present with the correct flag and type.
 * Used by the per-tool golden tests; a failure here is a failed extraction even when the
 * Schema parses.
 */
export function goldenCheck(schema: Schema, required: RequiredOption[]): GoldenResult {
  const missing: string[] = [];
  const typeMismatches: string[] = [];

  for (const need of required) {
    const match = schema.options.find((opt) => flagTokens(opt.flag).includes(need.flag));
    if (!match) {
      missing.push(need.flag);
      continue;
    }
    if (match.type !== need.type) {
      typeMismatches.push(`${need.flag}: expected ${need.type}, got ${match.type}`);
    }
  }

  return { ok: missing.length === 0 && typeMismatches.length === 0, missing, typeMismatches };
}
