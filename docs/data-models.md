# instagui — Data Models (the Schema contract)

_Generated: 2026-07-09 · Deep scan · Source: `src/core/schema.ts` (AD-4)_

instagui has **no database**. Its one data model is the **Schema** — a single Zod object that is the
contract between capture, UI, and execution. Authored with `zod/v4` (via zod ≥3.25's `zod/v4` subpath)
because `@anthropic-ai/sdk`'s `zodOutputFormat` binds to the zod v4 API.

## `OptionType`

```ts
z.enum(['string', 'number', 'boolean', 'enum', 'path'])
```

The control kind an option maps to in the Form. `path` is a plain string field in v1 (no native file
picker — a deliberate scope fence) but kept distinct from `string` so the UI can hint.

## `Option`

A flag-style option. **Every field is required by design** (structured-output JSON schema mode prefers
all-required + `additionalProperties:false`; an explicit empty value is less ambiguous to the model
than an omitted key).

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Canonical identifier (e.g. `codec`, `verbose`). Stable key for form + compose. |
| `flag` | string | The literal flag as in help (e.g. `--codec`, `-c`, `-c, --codec`). |
| `type` | `OptionType` | Control kind. |
| `description` | string | One-line description; `""` if none. |
| `enumValues` | string[] | Allowed values when `type === "enum"`; `[]` otherwise. |
| `required` | boolean | Whether the tool requires this option. |
| `group` | string | Help-section header (e.g. `Video options`); `""` if ungrouped. |

## `Positional`

A positional argument (e.g. ffmpeg input/output files). First-class, not folded into flags.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Identifier. |
| `type` | `OptionType` | Control kind. |
| `description` | string | One-line description; `""` if none. |
| `required` | boolean | Inferred from the usage line (`<output>` required). |
| `variadic` | boolean | Accepts multiple values (`[file...]`). **v1: a hint only** — each positional still contributes exactly one verbatim argument. |

## `Schema`

```ts
z.object({
  tool: z.string(),            // binary name, echoed from the request
  summary: z.string(),         // one-line tool summary; "" if unknown
  options: z.array(Option),
  positionals: z.array(Positional),
})
```

## Persistence & sources

The same Schema JSON is read/written across the resolution tiers (all validated through
`core/schema-file.ts`):

| Tier | Location | Mode | On invalid |
|---|---|---|---|
| `--schema` override | user-supplied path | read | **hard error** (exit 2, reason-specific) |
| user cache | `~/.instagui/<tool>.json` | read + write | silent fall-through (treat as miss) |
| bundled | packaged `schemas/<tool>.json` | read-only | silent fall-through |
| extraction | Claude output | validated then written to cache | 1 retry → debug file → exit 2 |

Tool-name keying (`core/cache.ts` `toolKey`) reduces a tool name to `[\w.-]`, collapsing anything else
(path separators, etc.) to `_`, so a tool name can never escape the cache dir.

## Composition (Schema → command)

`core/compose.ts` turns untrusted form state `{ options, positionals }` into an **arguments array**
(never a shell string), honoring Schema order (options first, then positionals):

- `boolean` → checked contributes the bare first flag; unchecked contributes nothing.
- other types → non-empty value contributes `[firstFlag, value]`; empty/undefined contributes nothing.
- `firstFlag("-c, --codec")` → `-c` (first listed flag token wins).

The same array feeds both the live preview and execution, so the preview can never diverge from what
runs.
