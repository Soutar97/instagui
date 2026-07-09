# Multi-engine AI extraction — Design Spec

_Date: 2026-07-09 · Branch: `feat/multi-engine-ai` · Status: approved design, pre-implementation_

## 1. Problem & goal

instagui's only AI touchpoint is **extraction**: turn a tool's `--help` text into a validated
`Schema` (one structured-JSON model call). Today that call is hardwired to two engines:

- `shared/claude.ts` — the Anthropic **SDK** path (needs `ANTHROPIC_API_KEY`), the default.
- `shared/claude-code.ts` — a **dev/test-only** adapter shelling out to `claude -p` (Claude
  subscription, no key), gated behind `INSTAGUI_ENGINE=claude-code`.

**Goal:** let users run extraction through **any AI**, via **either an API key or a subscription
CLI** — the way BMAD drives multiple coding-agent CLIs. Concretely: Anthropic, OpenAI, Google, and
any OpenAI-compatible provider (Ollama, Kimi/Moonshot, DeepSeek, Groq, OpenRouter, Together,
LM Studio, vLLM, …), plus the `claude` / `codex` / `gemini` subscription CLIs — **extensible by
configuration, not by a new integration per vendor.**

### How BMAD does it (reference)

BMAD never calls a model API directly. It drives coding-agent CLIs, each described by a small TOML
**profile** (`claude`, `codex`, `gemini`, `copilot`, `antigravity`) declaring `binary`,
`prompt_template`, `model_flag`, and a first-run auth note. The **API-vs-subscription** choice is not
BMAD's — it's whatever the underlying CLI is logged into. This design mirrors that idea (a small
adapter/profile registry) but adds direct-API adapters too, because pure-API providers
(Kimi, OpenRouter, …) have no CLI.

## 2. Non-goals (YAGNI)

- No per-tool engine overrides, no response caching, no streaming extraction.
- No engine-config GUI, no dynamically loaded JS provider plugins.
- No **native** Google/Gemini adapter in v1 — Gemini API is reached via its OpenAI-compatible
  endpoint (see §7). A native adapter is a fast-follow only if extraction quality proves insufficient.
- No change to the resolution precedence, capture, compose, server, or Schema contract.

## 3. Architecture

Everything hangs off the existing seam:

```ts
type CompleteFn = (req: CompletionRequest, client?: ClaudeClient) => Promise<string>;
// prompt + output shape in → raw JSON text out (NOT validated here)
```

`core/extract.ts` is **unchanged**: it already accepts an injected `opts.complete` and runs
`Schema.parse` + one retry + debug-file regardless of engine. The CLI resolves the selected engine
into a `CompleteFn` and passes it as `opts.complete`. All new code lives under `src/shared/`, keeping
the layer boundary intact (`core → shared`, engines are instagui-agnostic).

### 3.1 Three adapter *kinds*

| Kind | Covers | Auth |
|---|---|---|
| `anthropic` | Claude via the Anthropic SDK (today's path; wraps `shared/claude.ts`) | `ANTHROPIC_API_KEY` |
| `openai-compatible` | **OpenAI, Ollama, Kimi/Moonshot, DeepSeek, Groq, OpenRouter, Together, LM Studio, vLLM, and Gemini's OpenAI-compat endpoint** — anything speaking `POST /chat/completions` | API key or none (local) |
| `cli` | subscription shell-out: `claude`, `codex`, `gemini` CLIs, `ollama run` (generalizes today's `claude-code.ts`) | the CLI's own login |

The whole "cover all" matrix comes from these three kinds + configuration.

### 3.2 Module layout

```
src/shared/engines/
  types.ts       # EngineDescriptor, EngineKind, re-export CompleteFn
  config.ts      # load + zod-validate ~/.instagui/config.json
  registry.ts    # built-in engines + config merge; resolve(name) & autodetect()
  anthropic.ts   # kind: anthropic (delegates to shared/claude.ts)
  openai.ts      # kind: openai-compatible (fetch-based; fetch injectable)
  cli.ts         # kind: cli (generalizes shared/claude-code.ts; built-in profiles)
src/shared/engine.ts        # resolveComplete(selection?) now resolves via the registry (back-compat shim)
src/shared/claude.ts        # unchanged; used by the anthropic adapter
src/shared/claude-code.ts   # logic folded into cli.ts; kept as a thin re-export during transition
```

### 3.3 EngineDescriptor (in-memory shape)

```ts
type EngineKind = 'anthropic' | 'openai-compatible' | 'cli';

interface EngineDescriptor {
  name: string;                 // registry key, e.g. "openai", "claude"
  kind: EngineKind;
  model?: string;               // default model for this engine (overridable by --model)
  // API kinds:
  baseURL?: string;             // openai-compatible endpoint
  keyEnv?: string;              // name of the env var holding the API key (preferred)
  key?: string;                 // inline key (allowed, discouraged)
  structuredOutput?: 'auto' | 'json_schema' | 'json_object' | 'none'; // openai-compatible; default 'auto'
  // cli kind:
  binary?: string;             // e.g. "claude"
  modelFlag?: string;          // default "--model"
  extraArgs?: string[];        // static args appended to the invocation
  timeoutMs?: number;          // default 180_000 for cli
}
```

## 4. Configuration file

`~/.instagui/config.json` (reuses `shared/config.ts` `instaguiDir()`), zod-validated on load. A
corrupt/invalid file is a **user-facing error** (they wrote it) — `PreconditionError` (exit 2) naming
the exact problem — not a silent fall-through.

```json
{
  "default": "claude",
  "engines": {
    "claude":   { "kind": "cli", "binary": "claude", "model": "sonnet" },
    "anthropic":{ "kind": "anthropic", "keyEnv": "ANTHROPIC_API_KEY", "model": "claude-haiku-4-5" },
    "openai":   { "kind": "openai-compatible", "baseURL": "https://api.openai.com/v1", "keyEnv": "OPENAI_API_KEY", "model": "gpt-4o-mini" },
    "google":   { "kind": "openai-compatible", "baseURL": "https://generativelanguage.googleapis.com/v1beta/openai/", "keyEnv": "GEMINI_API_KEY", "model": "gemini-2.5-flash" },
    "ollama":   { "kind": "openai-compatible", "baseURL": "http://localhost:11434/v1", "model": "llama3.1" },
    "kimi":     { "kind": "openai-compatible", "baseURL": "https://api.moonshot.cn/v1", "keyEnv": "MOONSHOT_API_KEY", "model": "moonshot-v1-8k" }
  }
}
```

Keys in the file:
- `default` (optional) — engine name used when nothing else is selected (see §5).
- `engines` — a map of user-defined engines; **merged over** the built-ins (same name overrides).

### 4.1 Built-in engines (ship in code — zero-config common cases)

`anthropic`, `openai`, `google`, `ollama` (API kinds) and `claude`, `codex`, `gemini` (cli kind) are
registered in code with sensible defaults, so users need a config file only to add a provider (e.g.
`kimi`), change a model, or set a `default`.

## 5. Engine selection

Precedence (first hit wins):

1. `--engine <name>` (CLI flag)
2. `INSTAGUI_ENGINE` (env; **`claude-code` is a back-compat alias → the `claude` cli engine**)
3. config `default`
4. **auto-detect** (§6)

A selected name that doesn't resolve → `PreconditionError` (exit 2) listing available engine names.
Every extraction announces the resolved engine + why on **stderr**, e.g.:
`instagui: extracting via google (auto-detected: GEMINI_API_KEY)`.

## 6. Auto-detect ("a set API key is an explicit choice")

Runs only when steps 1–3 of §5 yielded nothing. Order:

1. **An API engine whose key env is set**, in order: `anthropic` (`ANTHROPIC_API_KEY`) →
   `openai` (`OPENAI_API_KEY`) → `google` (`GEMINI_API_KEY`). Setting a key is a deliberate act, so
   it wins — this makes the change **fully backward-compatible** for existing key users.
2. **Else a logged-in subscription CLI on `PATH`**, in order: `claude` → `codex` → `gemini`.
   (Detection = binary resolvable on `PATH`; we do not spawn an auth probe in v1.)
3. **Else** → the friendly onboarding error (§8), extended to also suggest logging into a CLI.

Consequences (serves all camps, no regression):
- Subscription user (no key, CLI logged in) → CLI automatically.
- API / existing user (key set) → API, exactly as today.
- Both set → API wins; `--engine claude` (or a config `default`) switches to subscription.

## 7. Structured output strategy (per kind)

instagui never *relies* on server-side schema enforcement — the JSON Schema (derived from the same
Zod object via `zodOutputFormat`) is embedded in the prompt as a universal floor, and
`core/extract.ts`'s retry + debug-file is the safety net. Per kind:

- **`anthropic`** — `zodOutputFormat(Schema)` via `output_config.format` (server-enforced), as today.
- **`openai-compatible`** — send `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` when `structuredOutput` is `auto`/`json_schema`; fall back to
  `{ type: "json_object" }` for `json_object`; **always also embed the JSON Schema in the prompt**
  (the `composePrompt` technique from `claude-code.ts`) so schema-poor endpoints (e.g. Ollama) still
  produce valid output. Response text is passed through `extractJsonText` before returning.
- **`cli`** — prompt-embedded schema + `extractJsonText()` on stdout (lifted from `claude-code.ts`).
  Prompt is piped over **stdin**, never the command line; spawn args are static flags only.

**Gemini (decision):** reached through the `google` built-in engine's OpenAI-compatible endpoint in
v1. Its partial `response_format` support is acceptable because of the prompt-embedded-schema floor +
retry. Native `generateContent` adapter deferred.

## 8. Error handling

All failures are `PreconditionError` (exit 2) with distinct, actionable messages (no stack trace):

- Unknown/uninstalled engine name → lists available engines.
- Selected **API** engine with no key → onboarding-style message naming the exact env var (extends
  `core/onboarding.ts`), noting the subscription-CLI alternative.
- Selected **cli** engine whose binary is missing / not authenticated → message with the profile's
  first-run note (e.g. "run `claude` once to sign in").
- Invalid `~/.instagui/config.json` → reason-specific parse/validation error.
- Network/transport error (API kinds) → wrapped with the endpoint + status.
- Malformed model output → **unchanged** existing retry + debug-file path.

Keys are **never** logged or echoed. Only local endpoints (`ollama`) may omit a key.

## 9. UX / CLI changes

- New flag **`--engine <name>`**; `--model <id>` still overrides the engine's default model.
- `INSTAGUI_ENGINE` accepts an engine name; `claude-code` preserved as an alias.
- New **`instagui --engines`** — lists configured engines and their detected availability
  (installed / key present / endpoint form), for discoverability.
- `USAGE` text updated to document `--engine`, the config file, and the precedence.
- Diagnostics line on every extraction naming the engine + selection reason.

## 10. Backward compatibility

- Only `ANTHROPIC_API_KEY` set, no CLIs, no config → auto-detect picks `anthropic` → **identical to
  today** (same default model `claude-haiku-4-5`).
- `INSTAGUI_ENGINE=claude-code` still works (alias).
- Bundled / user-cache / `--schema` tiers are untouched — still need **no engine at all**; the
  demo tools keep working with no key.
- `DEFAULT_MODEL` semantics preserved as the `anthropic` engine's default model.

## 11. Testing

- **Per-adapter unit tests** with injected `fetch` (openai-compatible) and injected `spawn` (cli) —
  no real network, no real processes. Assert request shape (endpoint, headers minus secrets, body,
  `response_format`), and JSON extraction from representative responses (incl. fenced / prose-wrapped).
- **Registry**: built-in + config merge, `resolve(name)`, precedence (§5), and unknown-name error.
- **Auto-detect** (§6) with faked env + `PATH`: key-first, CLI fallback, none → onboarding error.
- **Config**: zod validation happy-path + each failure reason; secret never surfaced in errors.
- **Back-compat**: `INSTAGUI_ENGINE=claude-code` alias; key-only path equals today's behavior.
- All existing `extract` / `resolve` / `compose` / server tests stay green; the ESLint
  dependency-boundary test (`test/eslint-dep-rule.test.ts`) still passes (engines are in `shared/`).

## 12. Security

- Config prefers `keyEnv` (env var **name**) over inline `key`; docs warn against committing keys and
  recommend file perms. Keys are never logged, echoed, or included in error text.
- API requests send the key only in the `Authorization` header (or provider-appropriate header).
- `cli` adapters pass the prompt via **stdin** and use static arg flags — no untrusted values on the
  command line, consistent with the rest of instagui's no-shell-string rule.

## 13. Rollout / branch

- Work lands on `feat/multi-engine-ai` (off latest `main`); local dev tooling
  (`.bmad-loop/`, `_bmad/`, `.claude/`) is gitignored so the PR is feature-only.
- Suggested PR order of commits: engine types + registry + config → anthropic adapter (extract from
  existing) → openai-compatible adapter → cli adapter (generalize claude-code) → selection/auto-detect
  wiring in `cli/index.ts` → `--engines` + docs → tests throughout.
- README + `docs/` updated (new "Choosing an AI engine" section).
