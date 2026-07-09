# instagui — Development Guide

_Generated: 2026-07-09 · Deep scan_

## Prerequisites

- **Node.js ≥ 22** (`package.json` `engines`). Uses `node:util` `parseArgs`, `node:test`, ESM.
- **`ANTHROPIC_API_KEY`** — only needed for **fresh extraction** (a new, non-bundled tool with no
  cache). The demo tools (ffmpeg, yt-dlp, pandoc), a cache hit, or `--schema` need no key.
  Get one at <https://console.anthropic.com/settings/keys>; `export ANTHROPIC_API_KEY="sk-ant-..."`.

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
`--help-file <path>`, `--capture`, `--model <id>`, `--port <n>`, `--no-open`, `-v/--version`, `-h/--help`.

### Dev engine (extract without an API key)

`INSTAGUI_ENGINE=claude-code` routes extraction through a headless Claude Code adapter
(`src/shared/claude-code.ts`) instead of the Anthropic SDK — a test harness for running extraction
without a key. Any other value (or unset) uses the SDK.

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
- **The API key is never read, logged, or sent to the browser.** Only `shared/config.ts` touches its
  presence.

## Where things live

- Add a new option **control type** → `core/schema.ts` (`OptionType`) + `server/page.ts`
  (`optionControl`) + `core/compose.ts` (`pushOption`).
- Change **resolution precedence** → `core/resolve.ts` (pure orchestration; test with fakes).
- Change **capture fallbacks** → `core/capture.ts` (`DEFAULT_ARG_SETS`, `isUsableHelp`, `tryMan`).
- Change the **extraction prompt/model** → `core/extract.ts` (`SYSTEM_PROMPT`, `DEFAULT_MODEL`).
- Add a **server route** → `server/server.ts` `handle()` (mind CSRF for state-changing routes).

## Build/publish notes

- `bin`: `instagui` → `dist/cli/index.js` (build first).
- Published `files`: `dist/`, `schemas/`, `LICENSE`, `README.md`.
- `readVersion()` reads the shipped `package.json` relative to the module, so it works from both
  `src/` (dev) and `dist/` (published).
