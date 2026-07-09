# instagui — Source Tree Analysis

_Generated: 2026-07-09 · Deep scan_

```
instagui/
├── src/
│   ├── cli/
│   │   └── index.ts          # ENTRY POINT (bin). Arg parsing, orchestration, exit-code mapping,
│   │                         #   USAGE text. Holds process open until Ctrl-C when serving.
│   ├── core/                 # Domain layer (depends only on shared/)
│   │   ├── schema.ts         # AD-4: THE Zod Schema contract (Option, Positional, Schema). zod/v4.
│   │   ├── capture.ts        # Story 1.2: capture --help (--help→-h→help→man), timeout + byte cap,
│   │   │                     #   stdout+stderr, isUsableHelp heuristic, man overstrike stripping.
│   │   ├── extract.ts        # The AI bet, isolated: help→Claude→Schema.parse, 1 retry, debug file.
│   │   │                     #   DEFAULT_MODEL = claude-haiku-4-5. SYSTEM_PROMPT (grounding rules).
│   │   ├── resolve.ts        # Resolution precedence orchestration (override>cache>bundled>extract).
│   │   ├── override.ts       # Story 2.2: --schema file loader (hard, reason-specific errors).
│   │   ├── cache.ts          # Story 2.1: ~/.instagui user cache (read/write, tool-name keying).
│   │   ├── bundled.ts        # Story 2.3: read-only packaged schemas/ (demo tools, no key).
│   │   ├── schema-file.ts    # Shared schema-file reader (never throws; typed failure result).
│   │   ├── onboarding.ts     # Story 2.4: friendly "API key needed" error (extraction tier only).
│   │   ├── errors.ts         # Typed errors: PreconditionError(2), ToolNotFoundError, NoHelpError.
│   │   ├── compose.ts        # Story 3.2: form state → args ARRAY (single source of truth) +
│   │   │                     #   previewString. Used by BOTH /preview and /run (no divergence).
│   │   └── golden.ts         # Golden-schema helpers (snapshot fixtures for extraction tests).
│   ├── server/               # Local HTTP Form server (depends on core/, shared/)
│   │   ├── server.ts         # node:http server: GET / , POST /preview, GET /events (SSE),
│   │   │                     #   POST /run, POST /stop. 127.0.0.1 only, CSRF fail-closed, port
│   │   │                     #   fallback on EADDRINUSE (default 5177).
│   │   ├── page.ts           # renderPage(schema): self-contained HTML (inline CSS+JS), controls
│   │   │                     #   by option type, grouped fieldsets, embeds Schema as JSON.
│   │   ├── client.ts         # CLIENT_SCRIPT: browser JS — build form state, live preview, run/stop,
│   │   │                     #   consume SSE stream. Does NOT re-implement compose.
│   │   ├── run.ts            # RunController: single-run lifecycle, spawn (args array), SIGTERM→KILL.
│   │   └── browser.ts        # openBrowser: platform-correct open command (best-effort).
│   └── shared/               # instagui-agnostic leaf layer (AD-3)
│       ├── claude.ts         # Anthropic client seam: complete(req, client?) → raw JSON string.
│       ├── claude-code.ts    # Dev-only headless Claude Code adapter (INSTAGUI_ENGINE=claude-code).
│       ├── engine.ts         # Engine selection (SDK default vs claude-code). ENGINE_ENV constant.
│       └── config.ts         # API_KEY_ENV, hasApiKey(), instaguiDir() (~/.instagui).
├── schemas/                  # Bundled demo Schemas (published). ffmpeg.json, yt-dlp.json, pandoc.json
├── scripts/
│   └── gen-bundled-schemas.ts# Regenerate the bundled schemas/ from live extraction.
├── test/                     # node:test suites (run via tsx). ~20 files + fixtures/.
├── design-artifacts/         # WDS-style planning: A-Product-Brief, B-Trigger-Map, C-UX-Scenarios,
│                             #   D-Design-System, E-Development. (Pre-existing product planning.)
├── docs/                     # THIS documentation (+ demo.gif).
├── package.json              # bin: instagui→dist/cli/index.js; scripts: build/lint/test/extract.
├── tsconfig.json             # TS config (src → dist, ESM, strict).
├── eslint.config.js          # ESLint flat config (incl. the layer dependency-boundary rule).
└── README.md                 # User-facing readme (money demo, quick start).
```

## Entry points

- **CLI**: `src/cli/index.ts` (shebang; published as `dist/cli/index.js` via `bin`).
- **Dev run without build**: `npm run extract` → `tsx src/cli/index.ts`.
- **HTTP server**: `startServer()` in `src/server/server.ts` (invoked by the CLI; default port 5177,
  falls back to an OS-assigned port if busy).

## Critical directories

| Dir | Role | Depends on |
|---|---|---|
| `src/cli` | Orchestration + process boundary (only place with `process.exit`) | core, server, shared |
| `src/core` | Pure domain logic; the Schema contract; resolution precedence | shared |
| `src/server` | Local web Form + execution/streaming | core, shared |
| `src/shared` | AI client + config; instagui-agnostic | — (leaf) |
