# instagui — Documentation Index

_Generated: 2026-07-09 · Deep scan · Brownfield documentation_
_This is the primary entry point for AI-assisted development. Point the brownfield PRD workflow here._

## Project overview

- **Type:** Monolith · **Project type:** CLI tool (with an embedded local web server)
- **Primary language:** TypeScript (ESM) on Node.js ≥ 22
- **Architecture:** Layered monolith with an enforced downward dependency direction
- **What it does:** `npx instagui <tool>` reads a CLI tool's `--help`, uses AI to turn it into a
  validated option Schema, serves it as a local web Form, and runs the command (streaming output)
  while showing the exact command it will run.

## Quick reference

- **Tech stack:** TypeScript ^5.9, Node ≥22, `@anthropic-ai/sdk` ^0.109, `zod` ^3.25 (`zod/v4`),
  `node:http` (server, SSE). Test: `node:test` + `tsx`. Build: `tsc`.
- **Entry point:** `src/cli/index.ts` (bin → `dist/cli/index.js`)
- **Server:** `src/server/server.ts` — `127.0.0.1` only, default port 5177
- **The contract:** one Zod `Schema` object (`src/core/schema.ts`, AD-4)
- **Resolution precedence:** `--schema > ~/.instagui cache > bundled schemas > fresh extraction`
- **Exit codes:** `0` ok · `2` known precondition · `1` unexpected

## Generated documentation

- [Project Overview](./project-overview.md)
- [Architecture](./architecture.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Data Models — the Schema contract](./data-models.md)
- [Local Server API Contracts](./api-contracts.md)
- [Development Guide](./development-guide.md)

## Existing documentation & artifacts

- [README.md](../README.md) — user-facing readme (money demo, quick start, flags)
- `design-artifacts/` — pre-existing WDS-style product planning: `A-Product-Brief`, `B-Trigger-Map`,
  `C-UX-Scenarios`, `D-Design-System`, `E-Development`. **Strong input for the PRD step.**
- `schemas/` — bundled demo Schemas (ffmpeg, yt-dlp, pandoc)

## Getting started

```sh
npm install
npm test                                   # full suite (node:test via tsx)
npx tsx src/cli/index.ts ffmpeg            # serve the ffmpeg form (bundled — no API key)
npm run build                              # tsc → dist/
```

See the [Development Guide](./development-guide.md) for the full command list, the dev engine
(`INSTAGUI_ENGINE=claude-code`), conventions, and layer guardrails.

## Next steps (BMAD planning)

1. Create the brownfield **PRD** (`/bmad-prd`), pointing it at this `index.md` and `design-artifacts/`.
2. **Architecture** (`/bmad-architecture`) — much can be lifted from [architecture.md](./architecture.md).
3. **Epics & stories** (`/bmad-create-epics-and-stories`).
4. **Sprint planning** (`/bmad-sprint-planning`) → produces `sprint-status.yaml` (the bmad-loop queue).
