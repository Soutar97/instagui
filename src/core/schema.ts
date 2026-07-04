// AD-4 — THE Schema contract. One Zod object, three consumers:
//   • zodOutputFormat(Schema)  → constrains the extraction API call (shared/claude.ts)
//   • z.infer<typeof Schema>   → the TS type used everywhere downstream
//   • Schema.parse(value)      → runtime validation of extraction output, cache reads,
//                                 --schema overrides, and bundled schemas
//
// Authored with `zod/v4` on purpose: @anthropic-ai/sdk's zodOutputFormat binds to the
// zod v4 API (zod ≥3.25 ships it at the `zod/v4` subpath). Importing plain `zod` (v3)
// here would type-mismatch against zodOutputFormat.
import { z } from 'zod/v4';

/**
 * The control kind an option maps to in the Form. `path` is a string field in v1
 * (no native picker — scope fence), kept distinct from `string` so the UI can hint.
 */
export const OptionType = z.enum(['string', 'number', 'boolean', 'enum', 'path']);
export type OptionType = z.infer<typeof OptionType>;

/**
 * A flag-style option. Every field is required by design: structured-output JSON schema
 * mode is happiest with all-required + additionalProperties:false, and an explicit empty
 * value ("" / [] / false) is less ambiguous to the model than an omitted key.
 */
export const Option = z.object({
  /** Canonical identifier, e.g. "codec" or "verbose". Stable key for form + compose. */
  name: z.string(),
  /** The literal flag as it appears in help, e.g. "--codec", "-c", "-c/--codec". */
  flag: z.string(),
  type: OptionType,
  /** One-line description; "" if the help gives none. */
  description: z.string(),
  /** Allowed values when type === "enum"; [] otherwise. */
  enumValues: z.array(z.string()),
  /** Whether the tool requires this option. */
  required: z.boolean(),
  /** Help-text section this belongs to, e.g. "Video options"; "" if ungrouped. */
  group: z.string(),
});
export type Option = z.infer<typeof Option>;

/**
 * A positional argument (e.g. ffmpeg input/output files). The money demo does not work
 * without these — they are first-class, not folded into flags.
 */
export const Positional = z.object({
  name: z.string(),
  type: OptionType,
  description: z.string(),
  required: z.boolean(),
  /** True if the positional accepts multiple values (e.g. "files..."). */
  variadic: z.boolean(),
});
export type Positional = z.infer<typeof Positional>;

/** The single structured description of a Tool's interface — the contract between
 *  capture, UI, and execution. */
export const Schema = z.object({
  /** The tool binary name, echoed from the request. */
  tool: z.string(),
  /** One-line summary of what the tool does; "" if unknown. */
  summary: z.string(),
  options: z.array(Option),
  positionals: z.array(Positional),
});
export type Schema = z.infer<typeof Schema>;
