# instagui — Architecture

_Generated: 2026-07-09 · Deep scan_

## Executive summary

instagui is a single-process Node.js CLI (ESM, TypeScript) that resolves a validated option
**Schema** for a target tool and serves it as a local web **Form**. The design isolates the one
uncertain part — AI extraction — behind a validated contract, and makes every other tier free,
keyless, and deterministic. Execution and the UI share one `compose` function so the previewed
command is provably identical to what runs.

## Architecture pattern

**Layered monolith with enforced dependency direction.** Four layers, dependencies point downward
only (a custom ESLint rule + `test/eslint-dep-rule.test.ts` guard this):

```
┌─────────────────────────────────────────────┐
│ cli/         entry point, arg parsing,        │  → core, server, shared
│              orchestration, exit-code mapping │
├─────────────────────────────────────────────┤
│ server/      local HTTP Form server           │  → core, shared
│              (page, preview, run, stream, stop)│
├─────────────────────────────────────────────┤
│ core/        domain: capture, extract,         │  → shared
│              resolve, compose, schema, cache   │
├─────────────────────────────────────────────┤
│ shared/      instagui-agnostic primitives      │  (leaf)
│              (claude client, engine, config)   │
└─────────────────────────────────────────────┘
```

## Primary flow — `instagui <tool>`

```
1. cli/index.ts       parse args (node:util parseArgs)
2. core/resolve.ts    resolution precedence:
      --schema ──────► core/override.ts        (loadOverrideSchema; hard error on bad file)
      cache    ──────► core/cache.ts           (~/.instagui/<tool>.json)
      bundled  ──────► core/bundled.ts         (packaged schemas/<tool>.json — read-only)
      else (extraction tier, needs API key):
        core/capture.ts   capture --help  (--help → -h → help → man; timeout + byte cap)
        core/extract.ts   help text → Claude → Schema.parse (1 retry, debug file on failure)
        core/cache.ts     write result back to ~/.instagui
3. --print? ──────────► print Schema JSON, exit 0
   else:
4. server/server.ts   startServer(schema)  → bind 127.0.0.1, render page
5. server/browser.ts  openBrowser(url)     (best-effort; URL also printed)
6. browser ⇄ server:
      POST /preview  → core/compose.ts → { args, preview }
      GET  /events   → SSE stream (owns the run lifecycle)
      POST /run      → compose → server/run.ts RunController.start (spawn, args array)
      POST /stop     → RunController.stop (SIGTERM → SIGKILL)
7. Ctrl-C ─────────► clean shutdown (end SSE, kill child, close server)
```

## Data architecture — the Schema contract (AD-4)

A single Zod object (`core/schema.ts`) is the contract between capture, UI, and execution. See
[data-models.md](./data-models.md). It has three consumers:

- `zodOutputFormat(Schema)` constrains the extraction API call (structured output).
- `z.infer<typeof Schema>` is the TS type used everywhere downstream.
- `Schema.parse` / `safeParse` validates extraction output, cache reads, `--schema` overrides,
  and bundled schemas.

All fields are required by design — structured-output JSON schema mode prefers all-required +
`additionalProperties:false`, and an explicit empty value (`""` / `[]` / `false`) is less ambiguous
to the model than an omitted key.

## The AI seam (AD-3)

- `shared/claude.ts` — a instagui-agnostic client: `complete(req, client?)` takes any Zod object as
  the output shape and returns the model's **raw JSON string** (not validated here). Callers run
  their own `Schema.parse`, which keeps the invalid raw text available for debugging.
- `shared/engine.ts` — engine selection. The SDK path is primary/default. `INSTAGUI_ENGINE=claude-code`
  opts into a dev-only headless Claude Code adapter (`shared/claude-code.ts`) for running extraction
  without an API key (test harness).
- Default extraction model: **`claude-haiku-4-5`** (`core/extract.ts` `DEFAULT_MODEL`), overridable
  via `--model`.
- Robustness: exactly one retry on malformed output, then the raw output is written to a
  `instagui-debug-<tool>-<ts>.json` file and a `PreconditionError` (exit 2) is thrown.

## Execution model (AD-5 / AD-6)

- **Single run in flight.** `server/run.ts` `RunController` refuses a second `start` while one is live.
- **Args array, never a shell.** `compose` returns a `string[]`; `spawn(cmd, args, { shell: false })`.
  Values with spaces/quotes/`;`/`&&` are single arguments with no shell meaning. `previewString`
  renders the same array for display only — Run never re-parses the string.
- **SSE owns the run.** The `/events` stream is the run's output sink; on disconnect (tab close/reload)
  the controller stops the child, so there is never an orphaned process.
- **Stop.** `SIGTERM`, escalating to `SIGKILL` after 2s (timer `unref`'d so it never holds the process).

## Security posture

- Server binds **`127.0.0.1` only** (NFR-2) — never a public interface.
- State-changing routes (`/run`, `/stop`) **fail closed** on a missing/mismatched `Origin` (CSRF, AD-6).
- Request bodies capped at 512 KB (413 on exceed).
- The API key lives only in `shared/config.ts` (env `ANTHROPIC_API_KEY`); it never reaches the page —
  only the Schema and tool name are served. Key presence is checked but its value is never read/logged.
- Help capture runs under a 10s timeout and 1 MB output cap so a misbehaving tool can't hang the launch.

## Testing strategy

- `node:test` run via `tsx` over `test/**/*.test.ts` (~20 test files).
- Dependency injection everywhere (spawn/runner, Claude client, completion fn, cache dir) so core
  and server are unit-testable with fakes — no real processes, no real API calls, no real browser.
- Notable suites: `hostile-extraction`, `extract-retry`, `resolve`, `compose`, `run`,
  `run-integration`, `golden`, `eslint-dep-rule` (guards the layer boundaries).

## Development & build

See [development-guide.md](./development-guide.md). Build is `tsc -p tsconfig.json` (`src/` → `dist/`);
the `bin` points at `dist/cli/index.js`.
