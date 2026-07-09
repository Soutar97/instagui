# instagui — Project Overview

_Generated: 2026-07-09 · Deep scan · Brownfield documentation_

## Purpose

**instagui** turns any command-line tool into a clean local web form — with no config and no
changes to the target tool. `npx instagui ffmpeg` reads the tool's own `--help` text, uses AI to
turn it into a structured option **Schema**, renders that Schema as a single-page web **Form**, opens
the browser, and (on **Run**) executes the command locally and streams the output back — while always
showing the exact command it will run, so it teaches the CLI instead of hiding it.

Positioning: unlike tools such as Gooey, instagui needs nothing from the tool's author — it parses
the tool's existing help text rather than requiring the tool to adopt a library.

## Tech stack

| Category | Technology | Version | Notes |
|---|---|---|---|
| Language | TypeScript | ^5.9 | ESM (`"type": "module"`), `strict` |
| Runtime | Node.js | ≥22 | Uses `parseArgs`, `node:test`, native fetch-era APIs |
| AI SDK | `@anthropic-ai/sdk` | ^0.109 | Structured output via `zodOutputFormat` |
| Validation | `zod` | ^3.25 (`zod/v4` subpath) | The Schema contract |
| HTTP | `node:http` | stdlib | Local Form server, SSE streaming |
| Build | `tsc` | — | `src/` → `dist/` |
| Test | `node:test` + `tsx` | — | `test/**/*.test.ts` |
| Lint | ESLint + typescript-eslint | ^9 / ^8 | Custom dep-boundary rule (see tests) |

Only two runtime dependencies: `@anthropic-ai/sdk` and `zod`.

## What ships

- **`bin`**: `instagui` → `dist/cli/index.js`
- **Published `files`**: `dist/`, `schemas/` (bundled demo schemas), `LICENSE`, `README.md`
- **Bundled demo schemas**: `ffmpeg`, `yt-dlp`, `pandoc` — work with **no API key** and no capture.

## Architecture at a glance

A **monolith** CLI with an embedded local web server, organized in three layers with a strict,
lint-enforced dependency direction:

```
cli → { core, server, shared }
server → { core, shared }
core → { shared }
shared → (leaf: no instagui-internal deps; instagui-agnostic)
```

- **`core/`** — the domain: capture help, extract a Schema (the AI bet, isolated), the resolution
  precedence, compose an argument array. Pure and heavily unit-tested via injected dependencies.
- **`server/`** — the local HTTP Form server: render page, live command preview, run + stream (SSE),
  stop. Binds `127.0.0.1` only; CSRF fail-closed on state-changing routes.
- **`shared/`** — instagui-agnostic primitives: the Anthropic client, engine selection, config
  (API key + `~/.instagui` data dir).

## Key design decisions (spine)

The codebase is spec-anchored — comments reference **Epics**, **Stories**, **ADs** (architecture
decisions), **FRs**/**NFRs**. The load-bearing ones:

- **AD-3** — `shared/` is instagui-agnostic; the Claude client knows nothing about Tools/Schemas/Forms.
- **AD-4** — one Zod `Schema` object is the single contract, with three consumers: constrains the AI
  call, provides the TS type, and validates all inputs (extraction output, cache, `--schema`, bundled).
- **AD-5** — exactly one run in flight; the SSE connection owns the run, so a disconnect kills the child.
- **AD-6** — execution uses an **arguments array**, never a shell string; CSRF-protected `/run` + `/stop`.
- **NFR-2** — server binds `127.0.0.1` only; the API key never reaches the browser.
- **Resolution precedence** — `--schema override > user cache (~/.instagui) > bundled > fresh extraction`.
  Only the extraction tier captures help or calls the AI (and needs a key).
- **Exit-code contract** — `0` ok · `2` known precondition failure · `1` unexpected.

## Detailed docs

- [Architecture](./architecture.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Data Models — the Schema contract](./data-models.md)
- [Local Server API Contracts](./api-contracts.md)
- [Development Guide](./development-guide.md)
