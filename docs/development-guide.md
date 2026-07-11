# instagui — Development Guide

_Generated: 2026-07-09 · Deep scan_

## Prerequisites

- **Node.js ≥ 22** (`package.json` `engines`). Uses `node:util` `parseArgs`, `node:test`, ESM.
- **An AI engine** — only needed for **fresh extraction** (a new, non-bundled tool with no cache).
  The demo tools (ffmpeg, yt-dlp, pandoc), a cache hit, or `--schema` need no engine. By default
  instagui auto-detects: `ANTHROPIC_API_KEY` (get one at
  <https://console.anthropic.com/settings/keys>; `export ANTHROPIC_API_KEY="sk-ant-..."`) works out
  of the box, or log into the `claude`/`codex`/`gemini` CLI. See `--engine` / `--engines` below and
  `docs/superpowers/specs/2026-07-09-multi-engine-ai-design.md` for the full selection model.

## Install

```sh
npm install
```

Runtime deps: `@anthropic-ai/sdk`, `zod`. Dev: `typescript`, `tsx`, `eslint`, `typescript-eslint`,
`@types/node`.

## Common commands

| Command | What it does |
|---|---|
| `npm run build` | `tsc -p tsconfig.json` → compiles `src/` to `dist/`. |
| `npm test` | `node --import tsx --test "test/**/*.test.ts"` — the full suite. |
| `npm run lint` | `eslint .` (includes the layer dependency-boundary rule). |
| `npm run extract` | `tsx src/cli/index.ts` — run the CLI from source without building. |

Run a single test file:
```sh
node --import tsx --test test/compose.test.ts
```

## Running the CLI in development

```sh
# from source (no build):
npx tsx src/cli/index.ts ffmpeg            # serve the ffmpeg form (bundled — no key)
npx tsx src/cli/index.ts mytool --print    # resolve + print Schema JSON, no server
echo "$(mytool --help)" | npx tsx src/cli/index.ts mytool   # pipe help on stdin
```

Useful flags (see `USAGE` in `src/cli/index.ts`): `--print`, `--schema <path>`, `--refresh`,
`--help-file <path>`, `--capture`, `--model <id>`, `--port <n>`, `--no-open`, `--engine <name>`,
`--engines`, `-v/--version`, `-h/--help`.

### Choosing an engine in development

- **`--engine <name>`** — pick an engine explicitly for one run: `anthropic`, `openai`, `google`,
  `ollama` (API kinds) or `claude`, `codex`, `gemini` (subscription CLIs), or any name defined in
  `~/.instagui/config.json`.
- **`instagui --engines`** — lists every registered engine, its kind, and whether it's ready right
  now (key present / CLI on `PATH`). Handy for checking what a fresh shell will auto-detect.
- **`INSTAGUI_ENGINE=claude-code`** still works — it's a back-compat alias for `--engine claude`
  (the `claude` CLI adapter, no API key needed, just `claude` logged in once). Any other
  `INSTAGUI_ENGINE` value is treated as an engine name.
- **`~/.instagui/config.json`** — add engines (e.g. `kimi`/Moonshot, a self-hosted vLLM endpoint),
  override a built-in's model, or set a `default` engine used when no flag/env selects one. Merged
  **over** the built-ins registered in `src/shared/engines/builtins.ts` (same name overrides). See
  the README's [Choosing an AI engine](../README.md#choosing-an-ai-engine) section for the example
  file and `docs/superpowers/specs/2026-07-09-multi-engine-ai-design.md` §4–§6 for the full
  precedence and auto-detect rules.
- New env keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, …) are each read only by
  the engine whose `keyEnv` names them (`src/shared/engines/openai.ts`) — setting one has no effect
  unless that engine is selected or wins auto-detect.

Selection precedence end-to-end: `--engine` flag > `INSTAGUI_ENGINE` env > config `default` >
auto-detect (a set API key wins over a logged-in CLI — see `src/shared/engines/registry.ts`
`selectEngine`/`autodetect`).

## Regenerate bundled demo schemas

```sh
npx tsx scripts/gen-bundled-schemas.ts     # rewrites schemas/*.json from live extraction
```
The published package ships `schemas/` so demo tools work with no key. This is a **read-only** tier at
runtime — fresh user extractions are written to `~/.instagui`, never here.

## Conventions & guardrails

- **ESM + `.js` import specifiers** in TS source (e.g. `import { x } from './y.js'`) — required for
  Node ESM resolution after compilation.
- **Layer boundaries are enforced**: `cli → core/server/shared`, `server → core/shared`,
  `core → shared`, `shared` is a leaf. `test/eslint-dep-rule.test.ts` guards this — don't add an
  upward or sideways import.
- **`process.exit` lives only in `cli/`.** Core throws typed errors (`PreconditionError` and
  subclasses); the CLI maps them to exit codes.
- **Exit-code contract**: `0` ok · `2` known precondition failure · `1` unexpected.
- **Execution safety**: never build a shell string — always spawn with an args array (`shell:false`).
- **Dependency injection for testability**: spawn/runner, Claude client, completion fn, and cache dir
  are all injectable. Prefer injecting a fake over touching the real process/API/filesystem in tests.
- **Engine API keys are never logged or sent to the browser.** Each engine adapter in
  `src/shared/engines/` reads only the env var its `keyEnv` names, and only checks presence —
  never logs the value.

## Where things live

- Add a new option **control type** → `core/schema.ts` (`OptionType`) + `server/page.ts`
  (`optionControl`) + `core/compose.ts` (`pushOption`).
- Change **resolution precedence** → `core/resolve.ts` (pure orchestration; test with fakes).
- Change **capture fallbacks** → `core/capture.ts` (`DEFAULT_ARG_SETS`, `isUsableHelp`, `tryMan`).
- Change the **extraction prompt/model** → `core/extract.ts` (`SYSTEM_PROMPT`, `DEFAULT_MODEL`).
- Add a **server route** → `server/server.ts` `handle()` (mind CSRF for state-changing routes).
- Add/change an **AI engine** → `src/shared/engines/builtins.ts` (built-in registration) and the
  relevant adapter (`anthropic.ts` / `openai.ts` / `cli.ts`); selection precedence and auto-detect
  live in `src/shared/engines/registry.ts`.

## Build/publish notes

- `bin`: `instagui` → `dist/cli/index.js` (build first).
- Published `files`: `dist/`, `schemas/`, `LICENSE`, `README.md`.
- `readVersion()` reads the shipped `package.json` relative to the module, so it works from both
  `src/` (dev) and `dist/` (published).
