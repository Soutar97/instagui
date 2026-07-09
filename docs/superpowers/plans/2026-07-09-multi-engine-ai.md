# Multi-engine AI extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let instagui run help-text extraction through any AI engine — API-key providers (Anthropic, OpenAI, Google, and any OpenAI-compatible endpoint like Ollama/Kimi) or subscription CLIs (`claude`/`codex`/`gemini`) — selectable by flag, env, config file, or auto-detect.

**Architecture:** A config-driven engine registry in `src/shared/engines/` produces a `CompleteFn` (the existing extraction seam). Three adapter *kinds* — `anthropic` (SDK), `openai-compatible` (fetch), `cli` (shell-out) — cover everything. `core/extract.ts` is unchanged; `cli/index.ts` resolves the selected engine and injects its `CompleteFn` via the existing `opts.complete` hook.

**Tech Stack:** TypeScript (ESM, Node ≥22), `zod` (`zod/v4` subpath), `@anthropic-ai/sdk` (existing, incl. `zodOutputFormat`), native `fetch`, `node:child_process`, `node:test` + `tsx`.

## Global Constraints

- **Node ≥ 22**, ESM. All intra-repo imports use `.js` specifiers (e.g. `./types.js`).
- **Layer boundary (ESLint-enforced):** new code lives in `src/shared/engines/`; `shared` must not import from `core`/`server`/`cli`. `test/eslint-dep-rule.test.ts` must stay green.
- **zod:** import from `'zod/v4'` (matches `src/core/schema.ts`); the `Schema`/`outputSchema` are zod v4 objects.
- **Exit codes:** user-facing failures throw `PreconditionError` (exit 2) from `src/core/errors.js`. Never call `process.exit` outside `src/cli/`.
- **Secrets:** API keys are read from env by name (`keyEnv`), never logged, never included in error messages or diagnostics.
- **No-shell rule:** `cli` adapters spawn with an args array (`shell:false` where possible) and pass the prompt via stdin when `promptVia:'stdin'`; the existing `claude-code.ts` uses `shell:true` only for Windows `.cmd` resolution — preserve that exact behavior in the generalized adapter.
- **Extraction contract unchanged:** an engine's `CompleteFn` returns *raw* model text (not validated). `core/extract.ts` keeps ownership of `Schema.parse` + one retry + debug-file.
- **Test runner:** `node --import tsx --test "test/**/*.test.ts"`; single file: `node --import tsx --test test/<name>.test.ts`.

---

## File Structure

**Create:**
- `src/shared/engines/types.ts` — `EngineKind`, `EngineDescriptor`, re-export `CompleteFn`.
- `src/shared/engines/structured.ts` — `jsonSchemaText`, `schemaInstruction`, `extractJsonText` (shared structured-output helpers).
- `src/shared/engines/config.ts` — load + zod-validate `~/.instagui/config.json` → `{ default?, engines }`.
- `src/shared/engines/builtins.ts` — built-in `EngineDescriptor`s (anthropic, openai, google, ollama, claude, codex, gemini).
- `src/shared/engines/anthropic.ts` — `createAnthropicComplete`, `anthropicAvailable`, `assertAnthropicReady`.
- `src/shared/engines/openai.ts` — `createOpenAIComplete`, `openaiAvailable`, `assertOpenAIReady`.
- `src/shared/engines/cli.ts` — `createCliComplete`, `cliAvailable`, `assertCliReady`, `buildCliArgv`.
- `src/shared/engines/registry.ts` — `buildRegistry`, `resolveEngine`, `autodetect`, `selectEngine`, `createComplete`, `describeEngines`.
- Tests mirror each under `test/engines-*.test.ts`.

**Modify:**
- `src/shared/engine.ts` — `resolveComplete` delegates to the registry; keep `ENGINE_ENV`, `activeEngineName` back-compat.
- `src/shared/claude-code.ts` — reduce to a thin re-export of the `cli` adapter's helpers (keep `INSTAGUI_ENGINE=claude-code` working).
- `src/cli/index.ts` — add `--engine`, resolve selection, inject `opts.complete`, stderr diagnostics, `--engines` listing, updated `USAGE`.
- `src/core/onboarding.ts` — extend the key-needed message to also mention subscription CLIs.
- `README.md`, `docs/` — "Choosing an AI engine" section.

---

## Task 1: Engine types + structured-output helpers

**Files:**
- Create: `src/shared/engines/types.ts`
- Create: `src/shared/engines/structured.ts`
- Test: `test/engines-structured.test.ts`

**Interfaces:**
- Consumes: `CompletionRequest`, `CompleteFn` from `src/shared/claude.ts`; `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`.
- Produces:
  - `type EngineKind = 'anthropic' | 'openai-compatible' | 'cli'`
  - `interface EngineDescriptor { name: string; kind: EngineKind; model?: string; baseURL?: string; keyEnv?: string; key?: string; structuredOutput?: 'auto'|'json_schema'|'json_object'|'none'; binary?: string; headlessArgs?: string[]; modelFlag?: string; promptVia?: 'stdin'|'arg'; promptFlag?: string; modelMap?: Record<string,string>; extraArgs?: string[]; timeoutMs?: number }`
  - `jsonSchemaText(outputSchema: CompletionRequest['outputSchema']): string`
  - `schemaInstruction(schemaText: string): string`
  - `extractJsonText(stdout: string): string`

- [ ] **Step 1: Write the failing test**

Create `test/engines-structured.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { jsonSchemaText, schemaInstruction, extractJsonText } from '../src/shared/engines/structured.js';

const Demo = z.object({ tool: z.string(), n: z.number() });

test('jsonSchemaText renders a JSON Schema mentioning the object properties', () => {
  const text = jsonSchemaText(Demo);
  assert.match(text, /"tool"/);
  assert.match(text, /"n"/);
  // valid JSON
  assert.doesNotThrow(() => JSON.parse(text));
});

test('schemaInstruction forbids fences and embeds the schema text', () => {
  const s = schemaInstruction('{"x":1}');
  assert.match(s, /ONLY a single JSON object/i);
  assert.match(s, /no code fences/i);
  assert.match(s, /\{"x":1\}/);
});

test('extractJsonText strips code fences', () => {
  assert.equal(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
});

test('extractJsonText slices the outermost object out of surrounding prose', () => {
  assert.equal(extractJsonText('sure, here:\n{"a":1}\nhope that helps'), '{"a":1}');
});

test('extractJsonText returns the trimmed input when no object is present (lets JSON.parse fail downstream)', () => {
  assert.equal(extractJsonText('  not json  '), 'not json');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-structured.test.ts`
Expected: FAIL — cannot find module `../src/shared/engines/structured.js`.

- [ ] **Step 3: Write `types.ts`**

```ts
// src/shared/engines/types.ts — shared engine descriptor shapes. instagui-agnostic.
import type { CompleteFn } from '../claude.js';
export type { CompleteFn };

/** The three adapter families that cover every provider (see design spec §3.1). */
export type EngineKind = 'anthropic' | 'openai-compatible' | 'cli';

/** How an OpenAI-compatible endpoint is asked for structured output. `auto` sends a
 *  strict json_schema response_format; schema is ALWAYS also embedded in the prompt. */
export type StructuredMode = 'auto' | 'json_schema' | 'json_object' | 'none';

/** A fully-resolved engine. API kinds use baseURL/keyEnv/key; the cli kind uses the
 *  binary/headlessArgs/... fields. `model` is the engine default (overridable by --model). */
export interface EngineDescriptor {
  name: string;
  kind: EngineKind;
  model?: string;

  // api kinds
  baseURL?: string;
  keyEnv?: string;
  key?: string;
  structuredOutput?: StructuredMode;

  // cli kind
  binary?: string;
  headlessArgs?: string[];       // e.g. ['-p'] (claude), ['exec'] (codex), [] (gemini)
  modelFlag?: string;            // default '--model'
  promptVia?: 'stdin' | 'arg';   // default 'stdin'
  promptFlag?: string;           // when promptVia==='arg', a flag preceding the prompt (e.g. '-p')
  modelMap?: Record<string, string>; // substring→alias (claude: 'haiku'→'haiku', ...)
  extraArgs?: string[];
  timeoutMs?: number;            // default 180_000
}
```

- [ ] **Step 4: Write `structured.ts`**

```ts
// src/shared/engines/structured.ts — structured-output helpers shared by the openai +
// cli adapters. Derives the JSON Schema from the SAME zod object the SDK uses, so every
// engine is asked for the identical shape core/extract.ts will validate.
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { CompletionRequest } from '../claude.js';

/** The JSON Schema (as pretty text) for an outputSchema, via the SDK's zodOutputFormat. */
export function jsonSchemaText(outputSchema: CompletionRequest['outputSchema']): string {
  const fmt = zodOutputFormat(outputSchema) as unknown as { schema: unknown };
  return JSON.stringify(fmt.schema, null, 2);
}

/** The universal "JSON only" instruction appended to prompts for engines without
 *  server-side schema enforcement (Ollama, CLIs). */
export function schemaInstruction(schemaText: string): string {
  return (
    `Respond with ONLY a single JSON object that conforms to this JSON Schema. ` +
    `No markdown, no code fences, no commentary before or after.\n\n` +
    `JSON Schema:\n${schemaText}`
  );
}

/** Pull the JSON object out of model stdout. Transport normalization only (fences /
 *  surrounding prose); does NOT validate — malformed text flows to extract.ts's retry. */
export function extractJsonText(stdout: string): string {
  let s = stdout.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) return s.slice(first, last + 1);
  return s;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-structured.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/engines/types.ts src/shared/engines/structured.ts test/engines-structured.test.ts
git commit -m "feat(engines): engine descriptor types + structured-output helpers"
```

---

## Task 2: Config file loader + validation

**Files:**
- Create: `src/shared/engines/config.ts`
- Test: `test/engines-config.test.ts`

**Interfaces:**
- Consumes: `EngineDescriptor` (Task 1); `instaguiDir` from `src/shared/config.js`; `PreconditionError` from `src/core/errors.js`; `z` from `zod/v4`.
- Produces:
  - `interface EngineConfig { default?: string; engines: Record<string, Omit<EngineDescriptor,'name'>> }`
  - `loadEngineConfig(dir?: string): EngineConfig` — returns `{ engines: {} }` when the file is absent; throws `PreconditionError` (exit 2) on an unreadable/invalid file.
  - `CONFIG_FILENAME = 'config.json'`

- [ ] **Step 1: Write the failing test**

Create `test/engines-config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEngineConfig } from '../src/shared/engines/config.js';
import { PreconditionError } from '../src/core/errors.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'instagui-cfg-'));
}

test('absent config file → empty engines, no default', () => {
  const cfg = loadEngineConfig(tmpDir());
  assert.deepEqual(cfg, { engines: {} });
});

test('valid config parses default + engines', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    default: 'kimi',
    engines: { kimi: { kind: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1', keyEnv: 'MOONSHOT_API_KEY', model: 'moonshot-v1-8k' } },
  }));
  const cfg = loadEngineConfig(dir);
  assert.equal(cfg.default, 'kimi');
  assert.equal(cfg.engines.kimi.kind, 'openai-compatible');
  assert.equal(cfg.engines.kimi.baseURL, 'https://api.moonshot.cn/v1');
});

test('invalid JSON → PreconditionError naming the file', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), '{ not json');
  assert.throws(() => loadEngineConfig(dir), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.equal(e.exitCode, 2);
    assert.match(e.message, /config\.json/);
    return true;
  });
});

test('bad shape (unknown kind) → PreconditionError', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ engines: { x: { kind: 'wat' } } }));
  assert.throws(() => loadEngineConfig(dir), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    return true;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-config.test.ts`
Expected: FAIL — module `../src/shared/engines/config.js` not found.

- [ ] **Step 3: Write `config.ts`**

```ts
// src/shared/engines/config.ts — load + validate ~/.instagui/config.json. A present-but-bad
// file is a user-facing error (they wrote it): PreconditionError (exit 2) naming the problem.
// Absent file → empty config (fall back to built-ins + auto-detect).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { instaguiDir } from '../config.js';
import { PreconditionError } from '../../core/errors.js';
import type { EngineDescriptor } from './types.js';

export const CONFIG_FILENAME = 'config.json';

const EngineEntry = z.object({
  kind: z.enum(['anthropic', 'openai-compatible', 'cli']),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  keyEnv: z.string().optional(),
  key: z.string().optional(),
  structuredOutput: z.enum(['auto', 'json_schema', 'json_object', 'none']).optional(),
  binary: z.string().optional(),
  headlessArgs: z.array(z.string()).optional(),
  modelFlag: z.string().optional(),
  promptVia: z.enum(['stdin', 'arg']).optional(),
  promptFlag: z.string().optional(),
  modelMap: z.record(z.string(), z.string()).optional(),
  extraArgs: z.array(z.string()).optional(),
  timeoutMs: z.number().optional(),
});

const ConfigShape = z.object({
  default: z.string().optional(),
  engines: z.record(z.string(), EngineEntry).default({}),
});

export interface EngineConfig {
  default?: string;
  engines: Record<string, Omit<EngineDescriptor, 'name'>>;
}

/** Load ~/.instagui/config.json. `dir` is injectable for tests. */
export function loadEngineConfig(dir: string = instaguiDir()): EngineConfig {
  const file = path.join(dir, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { engines: {} };
    throw new PreconditionError(`Could not read ${file}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new PreconditionError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = ConfigShape.safeParse(json);
  if (!parsed.success) {
    throw new PreconditionError(`${file} is not a valid instagui engine config:\n${parsed.error.message}`);
  }
  return parsed.data as EngineConfig;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engines/config.ts test/engines-config.test.ts
git commit -m "feat(engines): load + zod-validate ~/.instagui/config.json"
```

---

## Task 3: Built-in engines

**Files:**
- Create: `src/shared/engines/builtins.ts`
- Test: `test/engines-builtins.test.ts`

**Interfaces:**
- Consumes: `EngineDescriptor` (Task 1).
- Produces: `BUILTIN_ENGINES: Record<string, EngineDescriptor>` with keys `anthropic`, `openai`, `google`, `ollama`, `claude`, `codex`, `gemini`.

- [ ] **Step 1: Write the failing test**

Create `test/engines-builtins.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ENGINES } from '../src/shared/engines/builtins.js';

test('ships the expected built-in engine names', () => {
  assert.deepEqual(
    Object.keys(BUILTIN_ENGINES).sort(),
    ['anthropic', 'claude', 'codex', 'gemini', 'google', 'ollama', 'openai'],
  );
});

test('anthropic built-in preserves today default model + keyEnv', () => {
  const a = BUILTIN_ENGINES.anthropic;
  assert.equal(a.kind, 'anthropic');
  assert.equal(a.model, 'claude-haiku-4-5');
  assert.equal(a.keyEnv, 'ANTHROPIC_API_KEY');
});

test('google built-in uses the Gemini OpenAI-compatible endpoint', () => {
  const g = BUILTIN_ENGINES.google;
  assert.equal(g.kind, 'openai-compatible');
  assert.match(g.baseURL!, /generativelanguage\.googleapis\.com\/v1beta\/openai/);
  assert.equal(g.keyEnv, 'GEMINI_API_KEY');
});

test('claude built-in is a stdin cli engine that maps model aliases', () => {
  const c = BUILTIN_ENGINES.claude;
  assert.equal(c.kind, 'cli');
  assert.equal(c.binary, 'claude');
  assert.deepEqual(c.headlessArgs, ['-p']);
  assert.equal(c.promptVia, 'stdin');
  assert.equal(c.modelMap?.haiku, 'haiku');
});

test('every built-in name matches its map key', () => {
  for (const [k, v] of Object.entries(BUILTIN_ENGINES)) assert.equal(v.name, k);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-builtins.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `builtins.ts`**

```ts
// src/shared/engines/builtins.ts — zero-config engines registered in code. A user's
// ~/.instagui/config.json is merged OVER these (same name overrides). Model defaults are
// conservative + cheap; override per-engine via config or per-run via --model.
import type { EngineDescriptor } from './types.js';

export const BUILTIN_ENGINES: Record<string, EngineDescriptor> = {
  // API kinds
  anthropic: { name: 'anthropic', kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5' },
  openai: {
    name: 'openai', kind: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'gpt-4o-mini', structuredOutput: 'auto',
  },
  google: {
    name: 'google', kind: 'openai-compatible',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.5-flash', structuredOutput: 'auto',
  },
  ollama: {
    name: 'ollama', kind: 'openai-compatible',
    baseURL: 'http://localhost:11434/v1', model: 'llama3.1', structuredOutput: 'json_object',
  },

  // subscription CLIs
  claude: {
    name: 'claude', kind: 'cli', binary: 'claude', headlessArgs: ['-p'], modelFlag: '--model',
    promptVia: 'stdin', model: 'sonnet',
    modelMap: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  },
  codex: {
    name: 'codex', kind: 'cli', binary: 'codex', headlessArgs: ['exec'], modelFlag: '--model',
    promptVia: 'arg',
  },
  gemini: {
    name: 'gemini', kind: 'cli', binary: 'gemini', headlessArgs: [], modelFlag: '--model',
    promptVia: 'arg', promptFlag: '-p',
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-builtins.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engines/builtins.ts test/engines-builtins.test.ts
git commit -m "feat(engines): built-in engine descriptors (api + cli)"
```

---

## Task 4: Anthropic adapter

**Files:**
- Create: `src/shared/engines/anthropic.ts`
- Test: `test/engines-anthropic.test.ts`

**Interfaces:**
- Consumes: `EngineDescriptor` (Task 1); `complete`, `CompletionRequest`, `CompleteFn`, `ClaudeClient` from `src/shared/claude.js`; `hasApiKey`/env; `PreconditionError`.
- Produces:
  - `createAnthropicComplete(engine: EngineDescriptor, client?: ClaudeClient): CompleteFn`
  - `anthropicAvailable(engine: EngineDescriptor, env?: NodeJS.ProcessEnv): boolean`
  - `assertAnthropicReady(engine: EngineDescriptor, env?: NodeJS.ProcessEnv): void`

- [ ] **Step 1: Write the failing test**

Create `test/engines-anthropic.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { createAnthropicComplete, anthropicAvailable, assertAnthropicReady } from '../src/shared/engines/anthropic.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';
import type { ClaudeClient } from '../src/shared/claude.js';

const eng: EngineDescriptor = { name: 'anthropic', kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5' };
const Demo = z.object({ tool: z.string() });
const req = { model: 'claude-haiku-4-5', system: 's', user: 'u', outputSchema: Demo };

test('createAnthropicComplete sends the engine model and returns the SDK text', async () => {
  let seenModel = '';
  const fake: ClaudeClient = {
    messages: { create: async (body: any) => { seenModel = body.model; return { content: [{ type: 'text', text: '{"tool":"x"}' }] }; } },
  };
  const complete = createAnthropicComplete(eng, fake);
  const out = await complete(req);
  assert.equal(out, '{"tool":"x"}');
  assert.equal(seenModel, 'claude-haiku-4-5');
});

test('anthropicAvailable follows the key env presence', () => {
  assert.equal(anthropicAvailable(eng, { ANTHROPIC_API_KEY: 'sk-x' }), true);
  assert.equal(anthropicAvailable(eng, {}), false);
});

test('assertAnthropicReady throws PreconditionError naming the env var when the key is absent', () => {
  assert.throws(() => assertAnthropicReady(eng, {}), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /ANTHROPIC_API_KEY/);
    return true;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `anthropic.ts`**

```ts
// src/shared/engines/anthropic.ts — the Anthropic SDK engine (today's primary path), wrapped
// as an EngineDescriptor adapter. Delegates to shared/claude.ts `complete` for the actual call
// (server-enforced structured output via zodOutputFormat).
import { complete, type CompletionRequest, type CompleteFn, type ClaudeClient } from '../claude.js';
import { PreconditionError } from '../../core/errors.js';
import type { EngineDescriptor } from './types.js';

function keyName(engine: EngineDescriptor): string {
  return engine.keyEnv ?? 'ANTHROPIC_API_KEY';
}

export function anthropicAvailable(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  if (engine.key) return true;
  const v = env[keyName(engine)];
  return typeof v === 'string' && v.trim().length > 0;
}

export function assertAnthropicReady(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): void {
  if (!anthropicAvailable(engine, env)) {
    throw new PreconditionError(
      `Engine "${engine.name}" needs an Anthropic API key. Set ${keyName(engine)} ` +
        `(https://console.anthropic.com/settings/keys), or pick a subscription CLI with --engine claude.`,
    );
  }
}

/** Build a CompleteFn that calls the Anthropic SDK with the engine's model. */
export function createAnthropicComplete(engine: EngineDescriptor, client?: ClaudeClient): CompleteFn {
  return (req: CompletionRequest, injected?: ClaudeClient) => {
    const model = engine.model ?? req.model;
    return complete({ ...req, model }, injected ?? client);
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-anthropic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engines/anthropic.ts test/engines-anthropic.test.ts
git commit -m "feat(engines): anthropic SDK adapter"
```

---

## Task 5: OpenAI-compatible adapter

**Files:**
- Create: `src/shared/engines/openai.ts`
- Test: `test/engines-openai.test.ts`

**Interfaces:**
- Consumes: `EngineDescriptor` (Task 1); `jsonSchemaText`, `schemaInstruction`, `extractJsonText` (Task 1); `CompletionRequest`, `CompleteFn` from `src/shared/claude.js`; `PreconditionError`.
- Produces:
  - `type FetchLike = typeof fetch`
  - `interface OpenAIDeps { fetchFn?: FetchLike; env?: NodeJS.ProcessEnv }`
  - `createOpenAIComplete(engine: EngineDescriptor, deps?: OpenAIDeps): CompleteFn`
  - `openaiAvailable(engine: EngineDescriptor, env?: NodeJS.ProcessEnv): boolean`
  - `assertOpenAIReady(engine: EngineDescriptor, env?: NodeJS.ProcessEnv): void`

- [ ] **Step 1: Write the failing test**

Create `test/engines-openai.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { createOpenAIComplete, openaiAvailable, assertOpenAIReady } from '../src/shared/engines/openai.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';

const Demo = z.object({ tool: z.string() });
const req = { model: 'gpt-4o-mini', system: 'sys', user: 'usr', outputSchema: Demo };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const openai: EngineDescriptor = {
  name: 'openai', kind: 'openai-compatible', baseURL: 'https://api.openai.com/v1',
  keyEnv: 'OPENAI_API_KEY', model: 'gpt-4o-mini', structuredOutput: 'auto',
};

test('posts to <baseURL>/chat/completions with bearer auth, engine model, embedded schema, and json_schema format', async () => {
  let url = ''; let init: RequestInit = {};
  const fetchFn = (async (u: string, i: RequestInit) => {
    url = u; init = i;
    return jsonResponse({ choices: [{ message: { content: '{"tool":"ok"}' } }] });
  }) as unknown as typeof fetch;

  const complete = createOpenAIComplete(openai, { fetchFn, env: { OPENAI_API_KEY: 'sk-xyz' } });
  const out = await complete(req);

  assert.equal(out, '{"tool":"ok"}');
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer sk-xyz');
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.response_format.type, 'json_schema');
  // schema embedded in the user message (universal floor)
  const userMsg = body.messages.find((m: any) => m.role === 'user').content;
  assert.match(userMsg, /JSON Schema:/);
});

test('local endpoints need no key; json_object mode omits json_schema', async () => {
  const ollama: EngineDescriptor = { name: 'ollama', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', structuredOutput: 'json_object' };
  let body: any;
  const fetchFn = (async (_u: string, i: RequestInit) => { body = JSON.parse(String(i.body)); return jsonResponse({ choices: [{ message: { content: '{"tool":"z"}' } }] }); }) as unknown as typeof fetch;
  const out = await createOpenAIComplete(ollama, { fetchFn, env: {} })(req);
  assert.equal(out, '{"tool":"z"}');
  assert.equal(body.response_format.type, 'json_object');
});

test('non-2xx response → PreconditionError with status, no secret leak', async () => {
  const fetchFn = (async () => jsonResponse({ error: 'nope' }, 401)) as unknown as typeof fetch;
  await assert.rejects(
    () => createOpenAIComplete(openai, { fetchFn, env: { OPENAI_API_KEY: 'sk-secret' } })(req),
    (e: unknown) => {
      assert.ok(e instanceof PreconditionError);
      assert.match(e.message, /401/);
      assert.doesNotMatch(e.message, /sk-secret/);
      return true;
    },
  );
});

test('availability + readiness follow key presence (local baseURL is always ready)', () => {
  assert.equal(openaiAvailable(openai, { OPENAI_API_KEY: 'x' }), true);
  assert.equal(openaiAvailable(openai, {}), false);
  const ollama: EngineDescriptor = { name: 'ollama', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1' };
  assert.equal(openaiAvailable(ollama, {}), true); // no keyEnv → treated as keyless/local
  assert.throws(() => assertOpenAIReady(openai, {}), (e) => e instanceof PreconditionError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `openai.ts`**

```ts
// src/shared/engines/openai.ts — the openai-compatible engine: any endpoint speaking
// POST /chat/completions (OpenAI, Ollama, Kimi, DeepSeek, Groq, OpenRouter, Together,
// LM Studio, vLLM, Gemini's OpenAI-compat endpoint). fetch is injectable for tests.
//
// Structured output: `response_format` is sent per `structuredOutput`, and the JSON Schema
// is ALWAYS embedded in the user message so schema-poor endpoints still comply. Validation
// stays in core/extract.ts (this returns raw text).
import type { CompletionRequest, CompleteFn } from '../claude.js';
import { PreconditionError } from '../../core/errors.js';
import { jsonSchemaText, schemaInstruction, extractJsonText } from './structured.js';
import type { EngineDescriptor, StructuredMode } from './types.js';

export type FetchLike = typeof fetch;
export interface OpenAIDeps {
  fetchFn?: FetchLike;
  env?: NodeJS.ProcessEnv;
}

/** An engine is keyless when it declares no keyEnv (e.g. local Ollama). */
function keyless(engine: EngineDescriptor): boolean {
  return !engine.keyEnv && !engine.key;
}

function apiKey(engine: EngineDescriptor, env: NodeJS.ProcessEnv): string | undefined {
  if (engine.key) return engine.key;
  return engine.keyEnv ? env[engine.keyEnv] : undefined;
}

export function openaiAvailable(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  if (keyless(engine)) return true;
  const k = apiKey(engine, env);
  return typeof k === 'string' && k.trim().length > 0;
}

export function assertOpenAIReady(engine: EngineDescriptor, env: NodeJS.ProcessEnv = process.env): void {
  if (!openaiAvailable(engine, env)) {
    throw new PreconditionError(
      `Engine "${engine.name}" needs an API key. Set ${engine.keyEnv} for its endpoint (${engine.baseURL}).`,
    );
  }
}

function responseFormat(mode: StructuredMode | undefined, schema: unknown): Record<string, unknown> {
  const m = mode ?? 'auto';
  if (m === 'none') return {};
  if (m === 'json_object') return { response_format: { type: 'json_object' } };
  // auto | json_schema
  return { response_format: { type: 'json_schema', json_schema: { name: 'instagui_schema', schema, strict: true } } };
}

export function createOpenAIComplete(engine: EngineDescriptor, deps: OpenAIDeps = {}): CompleteFn {
  const fetchFn = deps.fetchFn ?? fetch;
  const env = deps.env ?? process.env;

  return async (req: CompletionRequest): Promise<string> => {
    if (!engine.baseURL) throw new PreconditionError(`Engine "${engine.name}" is missing baseURL.`);
    assertOpenAIReady(engine, env);

    const schemaText = jsonSchemaText(req.outputSchema);
    const fmt = JSON.parse(schemaText) as unknown;
    const url = `${engine.baseURL.replace(/\/$/, '')}/chat/completions`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = apiKey(engine, env);
    if (key) headers.authorization = `Bearer ${key}`;

    const body = {
      model: engine.model ?? req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: `${req.user}\n\n${schemaInstruction(schemaText)}` },
      ],
      max_tokens: req.maxTokens ?? 16000,
      ...responseFormat(engine.structuredOutput, fmt),
    };

    let res: Response;
    try {
      res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new PreconditionError(`Request to ${engine.name} (${url}) failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      throw new PreconditionError(`Engine "${engine.name}" returned HTTP ${res.status} from ${url}. ${detail}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    return extractJsonText(content);
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-openai.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engines/openai.ts test/engines-openai.test.ts
git commit -m "feat(engines): openai-compatible adapter (covers openai/ollama/kimi/...)"
```

---

## Task 6: CLI (subscription) adapter

**Files:**
- Create: `src/shared/engines/cli.ts`
- Test: `test/engines-cli.test.ts`

**Interfaces:**
- Consumes: `EngineDescriptor` (Task 1); `jsonSchemaText`, `schemaInstruction`, `extractJsonText` (Task 1); `CompletionRequest`, `CompleteFn`; `PreconditionError`.
- Produces:
  - `buildCliArgv(engine: EngineDescriptor, model: string, prompt: string): { argv: string[]; stdin: string }`
  - `type RunCli = (binary: string, argv: string[], stdin: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string; code: number | null }>`
  - `interface CliDeps { run?: RunCli; onPath?: (binary: string) => boolean }`
  - `createCliComplete(engine: EngineDescriptor, deps?: CliDeps): CompleteFn`
  - `cliAvailable(engine: EngineDescriptor, deps?: CliDeps): boolean`
  - `assertCliReady(engine: EngineDescriptor, deps?: CliDeps): void`

- [ ] **Step 1: Write the failing test**

Create `test/engines-cli.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { buildCliArgv, createCliComplete, cliAvailable, assertCliReady } from '../src/shared/engines/cli.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';

const Demo = z.object({ tool: z.string() });
const req = { model: 'sonnet', system: 'SYS', user: 'USR', outputSchema: Demo };

const claude: EngineDescriptor = {
  name: 'claude', kind: 'cli', binary: 'claude', headlessArgs: ['-p'], modelFlag: '--model',
  promptVia: 'stdin', model: 'sonnet', modelMap: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
};

test('buildCliArgv (stdin mode) puts the prompt on stdin and maps the model alias', () => {
  const { argv, stdin } = buildCliArgv(claude, 'claude-3-5-haiku', 'PROMPT');
  assert.deepEqual(argv, ['-p', '--model', 'haiku']);
  assert.equal(stdin, 'PROMPT');
});

test('buildCliArgv (arg mode with promptFlag) passes the prompt as an argument', () => {
  const gemini: EngineDescriptor = { name: 'gemini', kind: 'cli', binary: 'gemini', headlessArgs: [], modelFlag: '--model', promptVia: 'arg', promptFlag: '-p' };
  const { argv, stdin } = buildCliArgv(gemini, 'gemini-2.5-flash', 'PROMPT');
  assert.deepEqual(argv, ['--model', 'gemini-2.5-flash', '-p', 'PROMPT']);
  assert.equal(stdin, '');
});

test('createCliComplete composes system+user+schema and returns extracted JSON', async () => {
  let seenStdin = ''; let seenArgv: string[] = [];
  const run = async (_bin: string, argv: string[], stdin: string) => { seenArgv = argv; seenStdin = stdin; return { stdout: '```json\n{"tool":"cli"}\n```', stderr: '', code: 0 }; };
  const out = await createCliComplete(claude, { run, onPath: () => true })(req);
  assert.equal(out, '{"tool":"cli"}');
  assert.match(seenStdin, /SYS/);
  assert.match(seenStdin, /USR/);
  assert.match(seenStdin, /JSON Schema:/);
  assert.deepEqual(seenArgv, ['-p', '--model', 'sonnet']);
});

test('non-zero exit → PreconditionError with stderr', async () => {
  const run = async () => ({ stdout: '', stderr: 'boom', code: 1 });
  await assert.rejects(() => createCliComplete(claude, { run, onPath: () => true })(req), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /boom/);
    return true;
  });
});

test('availability + readiness follow PATH; missing binary → actionable error', () => {
  assert.equal(cliAvailable(claude, { onPath: () => true }), true);
  assert.equal(cliAvailable(claude, { onPath: () => false }), false);
  assert.throws(() => assertCliReady(claude, { onPath: () => false }), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /claude/);
    return true;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `cli.ts`**

```ts
// src/shared/engines/cli.ts — the subscription CLI engine: shell out to a coding CLI
// (claude/codex/gemini, or `ollama` etc. via config) that is authenticated by the user's
// own login. Generalizes the former shared/claude-code.ts. Prompt goes over stdin
// (promptVia:'stdin') or as an argument (promptVia:'arg'); args are static flags only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PreconditionError } from '../../core/errors.js';
import { jsonSchemaText, schemaInstruction, extractJsonText } from './structured.js';
import type { CompletionRequest, CompleteFn } from '../claude.js';
import type { EngineDescriptor } from './types.js';

const DEFAULT_TIMEOUT_MS = 180_000;

export type RunCli = (
  binary: string, argv: string[], stdin: string, timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export interface CliDeps {
  run?: RunCli;
  onPath?: (binary: string) => boolean;
}

/** Map an API model id to a CLI alias when the engine provides a modelMap (substring match);
 *  otherwise pass the model through unchanged. */
function mapModel(engine: EngineDescriptor, model: string): string {
  const map = engine.modelMap;
  if (!map) return model;
  for (const [needle, alias] of Object.entries(map)) {
    if (model.includes(needle)) return alias;
  }
  return model;
}

/** Compose the invocation. Returns argv (WITHOUT the binary) and the stdin payload. */
export function buildCliArgv(engine: EngineDescriptor, model: string, prompt: string): { argv: string[]; stdin: string } {
  const argv: string[] = [...(engine.headlessArgs ?? [])];
  argv.push(engine.modelFlag ?? '--model', mapModel(engine, model));
  argv.push(...(engine.extraArgs ?? []));
  if ((engine.promptVia ?? 'stdin') === 'arg') {
    if (engine.promptFlag) argv.push(engine.promptFlag);
    argv.push(prompt);
    return { argv, stdin: '' };
  }
  return { argv, stdin: prompt };
}

/** Default runner: spawn with shell:true so a Windows `<bin>.cmd` shim resolves via PATHEXT
 *  (matches the former claude-code.ts). Args are static flags; when promptVia:'stdin' the
 *  prompt never touches the command line. */
const defaultRun: RunCli = (binary, argv, stdin, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, argv, { shell: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new PreconditionError(`${binary} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) => { clearTimeout(timer); reject(new PreconditionError(`${binary} failed to start: ${err.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });

function onPathDefault(binary: string): boolean {
  // Best-effort: probe PATH entries for the binary (or a Windows shim). No spawn.
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return dirs.some((dir) => exts.some((ext) => existsSync(path.join(dir, binary + ext))));
}

export function cliAvailable(engine: EngineDescriptor, deps: CliDeps = {}): boolean {
  const onPath = deps.onPath ?? onPathDefault;
  return !!engine.binary && onPath(engine.binary);
}

export function assertCliReady(engine: EngineDescriptor, deps: CliDeps = {}): void {
  if (!engine.binary) throw new PreconditionError(`Engine "${engine.name}" is missing a binary.`);
  if (!cliAvailable(engine, deps)) {
    throw new PreconditionError(
      `Engine "${engine.name}" needs the "${engine.binary}" CLI on your PATH, signed in. ` +
        `Install it and run "${engine.binary}" once to authenticate, or choose another --engine.`,
    );
  }
}

export function createCliComplete(engine: EngineDescriptor, deps: CliDeps = {}): CompleteFn {
  const run = deps.run ?? defaultRun;
  return async (req: CompletionRequest): Promise<string> => {
    assertCliReady(engine, deps);
    const prompt = `${req.system}\n\n${req.user}\n\n${schemaInstruction(jsonSchemaText(req.outputSchema))}`;
    const model = engine.model ?? req.model;
    const { argv, stdin } = buildCliArgv(engine, model, prompt);
    const { stdout, stderr, code } = await run(engine.binary!, argv, stdin, engine.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (code !== 0) throw new PreconditionError(`${engine.binary} exited with code ${code}: ${stderr.trim() || '(no stderr)'}`);
    const json = extractJsonText(stdout);
    if (json.trim().length === 0) throw new PreconditionError(`${engine.binary} returned empty output.`);
    return json;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-cli.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the lint to confirm the layer boundary + rules hold**

Run: `npm run lint`
Expected: PASS (imports are pure Node stdlib, allowed in `shared/`; no upward imports, so the dependency-boundary rule stays green).

- [ ] **Step 6: Commit**

```bash
git add src/shared/engines/cli.ts test/engines-cli.test.ts
git commit -m "feat(engines): subscription CLI adapter (generalizes claude-code)"
```

---

## Task 7: Registry — resolution, auto-detect, selection, dispatch

**Files:**
- Create: `src/shared/engines/registry.ts`
- Test: `test/engines-registry.test.ts`

**Interfaces:**
- Consumes: everything above — `BUILTIN_ENGINES` (Task 3), `EngineConfig`/`loadEngineConfig` (Task 2), the three adapters' `create*`/`*Available` (Tasks 4–6), `EngineDescriptor`, `CompleteFn`, `PreconditionError`.
- Produces:
  - `interface SelectDeps { onPath?: (b: string) => boolean; env?: NodeJS.ProcessEnv }`
  - `buildRegistry(config: EngineConfig): Record<string, EngineDescriptor>`
  - `resolveEngine(name: string, registry: Record<string, EngineDescriptor>): EngineDescriptor`
  - `engineAvailable(engine: EngineDescriptor, deps?: SelectDeps): boolean`
  - `autodetect(registry: Record<string, EngineDescriptor>, deps?: SelectDeps): { engine: EngineDescriptor; reason: string } | null`
  - `selectEngine(opts: { flag?: string; envName?: string; config: EngineConfig }, deps?: SelectDeps): { engine: EngineDescriptor; reason: string }`
  - `createComplete(engine: EngineDescriptor, deps?: SelectDeps): CompleteFn`
  - `describeEngines(registry: Record<string, EngineDescriptor>, deps?: SelectDeps): Array<{ name: string; kind: string; available: boolean; detail: string }>`
- **Auto-detect order (design §6):** API engines whose key env is set, in order `anthropic`→`openai`→`google`; else CLI engines on PATH in order `claude`→`codex`→`gemini`.
- **Selection precedence (design §5):** `flag` › `envName` (with `claude-code` aliased to `claude`) › `config.default` › `autodetect()` › onboarding error.

- [ ] **Step 1: Write the failing test**

Create `test/engines-registry.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistry, resolveEngine, autodetect, selectEngine, describeEngines,
} from '../src/shared/engines/registry.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineConfig } from '../src/shared/engines/config.js';

const emptyCfg: EngineConfig = { engines: {} };

test('buildRegistry merges user engines over built-ins', () => {
  const reg = buildRegistry({ engines: { kimi: { kind: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1', keyEnv: 'MOONSHOT_API_KEY' }, anthropic: { kind: 'anthropic', model: 'claude-opus-4-8' } } });
  assert.equal(reg.kimi.name, 'kimi');
  assert.equal(reg.anthropic.model, 'claude-opus-4-8'); // override wins
  assert.ok(reg.claude); // built-in still present
});

test('resolveEngine throws a listing error on an unknown name', () => {
  const reg = buildRegistry(emptyCfg);
  assert.throws(() => resolveEngine('nope', reg), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /nope/);
    assert.match(e.message, /anthropic/); // lists available
    return true;
  });
});

test('autodetect prefers a set API key (anthropic) over an installed CLI', () => {
  const reg = buildRegistry(emptyCfg);
  const got = autodetect(reg, { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => true });
  assert.equal(got?.engine.name, 'anthropic');
  assert.match(got!.reason, /ANTHROPIC_API_KEY/);
});

test('autodetect falls back to a CLI when no API key is set', () => {
  const reg = buildRegistry(emptyCfg);
  const got = autodetect(reg, { env: {}, onPath: (b) => b === 'claude' });
  assert.equal(got?.engine.name, 'claude');
});

test('autodetect returns null when nothing is available', () => {
  const reg = buildRegistry(emptyCfg);
  assert.equal(autodetect(reg, { env: {}, onPath: () => false }), null);
});

test('selectEngine precedence: flag > env > default > autodetect', () => {
  const reg = { config: { default: 'openai', engines: {} } as EngineConfig };
  const deps = { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => true };
  assert.equal(selectEngine({ flag: 'ollama', config: reg.config }, deps).engine.name, 'ollama');
  assert.equal(selectEngine({ envName: 'google', config: reg.config }, deps).engine.name, 'google');
  assert.equal(selectEngine({ config: reg.config }, deps).engine.name, 'openai'); // config default
  assert.equal(selectEngine({ config: { engines: {} } }, deps).engine.name, 'anthropic'); // autodetect
});

test('selectEngine aliases INSTAGUI_ENGINE=claude-code to the claude engine', () => {
  const got = selectEngine({ envName: 'claude-code', config: { engines: {} } }, { env: {}, onPath: () => true });
  assert.equal(got.engine.name, 'claude');
});

test('selectEngine with nothing available throws the onboarding error', () => {
  assert.throws(() => selectEngine({ config: { engines: {} } }, { env: {}, onPath: () => false }), (e) => e instanceof PreconditionError);
});

test('describeEngines reports availability per engine', () => {
  const reg = buildRegistry(emptyCfg);
  const rows = describeEngines(reg, { env: { OPENAI_API_KEY: 'x' }, onPath: (b) => b === 'gemini' });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.openai.available, true);
  assert.equal(byName.gemini.available, true);
  assert.equal(byName.anthropic.available, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engines-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `registry.ts`**

```ts
// src/shared/engines/registry.ts — the one place that knows all engines: merges built-ins
// with user config, resolves a name, auto-detects, applies selection precedence, and
// dispatches an EngineDescriptor to the right adapter's CompleteFn.
import { PreconditionError } from '../../core/errors.js';
import type { CompleteFn } from '../claude.js';
import type { EngineDescriptor } from './types.js';
import type { EngineConfig } from './config.js';
import { BUILTIN_ENGINES } from './builtins.js';
import { createAnthropicComplete, anthropicAvailable, assertAnthropicReady } from './anthropic.js';
import { createOpenAIComplete, openaiAvailable, assertOpenAIReady } from './openai.js';
import { createCliComplete, cliAvailable, assertCliReady } from './cli.js';

export interface SelectDeps {
  onPath?: (binary: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

/** Auto-detect order (design §6). */
const API_DETECT_ORDER = ['anthropic', 'openai', 'google'];
const CLI_DETECT_ORDER = ['claude', 'codex', 'gemini'];

export function buildRegistry(config: EngineConfig): Record<string, EngineDescriptor> {
  const reg: Record<string, EngineDescriptor> = {};
  for (const [name, e] of Object.entries(BUILTIN_ENGINES)) reg[name] = { ...e, name };
  for (const [name, e] of Object.entries(config.engines)) reg[name] = { ...(reg[name] ?? {}), ...e, name };
  return reg;
}

export function resolveEngine(name: string, registry: Record<string, EngineDescriptor>): EngineDescriptor {
  const engine = registry[name];
  if (!engine) {
    const available = Object.keys(registry).sort().join(', ');
    throw new PreconditionError(`Unknown engine "${name}". Available engines: ${available}.`);
  }
  return engine;
}

export function engineAvailable(engine: EngineDescriptor, deps: SelectDeps = {}): boolean {
  const env = deps.env ?? process.env;
  if (engine.kind === 'anthropic') return anthropicAvailable(engine, env);
  if (engine.kind === 'openai-compatible') return openaiAvailable(engine, env);
  return cliAvailable(engine, { onPath: deps.onPath });
}

export function autodetect(
  registry: Record<string, EngineDescriptor>, deps: SelectDeps = {},
): { engine: EngineDescriptor; reason: string } | null {
  const env = deps.env ?? process.env;
  for (const name of API_DETECT_ORDER) {
    const e = registry[name];
    if (e && engineAvailable(e, deps)) return { engine: e, reason: `auto-detected: ${e.keyEnv ?? 'api key'}` };
  }
  for (const name of CLI_DETECT_ORDER) {
    const e = registry[name];
    if (e && engineAvailable(e, deps)) return { engine: e, reason: `auto-detected: ${e.binary} CLI on PATH` };
  }
  return null;
}

/** Selection precedence (design §5). `envName` accepts the back-compat alias "claude-code". */
export function selectEngine(
  opts: { flag?: string; envName?: string; config: EngineConfig }, deps: SelectDeps = {},
): { engine: EngineDescriptor; reason: string } {
  const registry = buildRegistry(opts.config);

  if (opts.flag) return { engine: resolveEngine(opts.flag, registry), reason: 'selected by --engine' };

  if (opts.envName) {
    const name = opts.envName === 'claude-code' ? 'claude' : opts.envName;
    return { engine: resolveEngine(name, registry), reason: 'selected by INSTAGUI_ENGINE' };
  }

  if (opts.config.default) return { engine: resolveEngine(opts.config.default, registry), reason: 'config default' };

  const detected = autodetect(registry, deps);
  if (detected) return detected;

  throw new PreconditionError(
    `No AI engine is configured. Set an API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY), ` +
      `log into a CLI (claude/codex/gemini), or add one to ~/.instagui/config.json. Run "instagui --engines" to see options.`,
  );
}

/** Dispatch a resolved engine to its adapter, asserting readiness first. */
export function createComplete(engine: EngineDescriptor, deps: SelectDeps = {}): CompleteFn {
  const env = deps.env ?? process.env;
  if (engine.kind === 'anthropic') { assertAnthropicReady(engine, env); return createAnthropicComplete(engine); }
  if (engine.kind === 'openai-compatible') { assertOpenAIReady(engine, env); return createOpenAIComplete(engine, { env }); }
  assertCliReady(engine, { onPath: deps.onPath });
  return createCliComplete(engine, { onPath: deps.onPath });
}

export function describeEngines(
  registry: Record<string, EngineDescriptor>, deps: SelectDeps = {},
): Array<{ name: string; kind: string; available: boolean; detail: string }> {
  return Object.values(registry).map((e) => ({
    name: e.name,
    kind: e.kind,
    available: engineAvailable(e, deps),
    detail: e.kind === 'cli' ? `cli:${e.binary}` : `${e.baseURL ?? 'anthropic'} ${e.keyEnv ? `(${e.keyEnv})` : '(no key)'}`,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/engines-registry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engines/registry.ts test/engines-registry.test.ts
git commit -m "feat(engines): registry — resolve, auto-detect, selection, dispatch"
```

---

## Task 8: Back-compat shim — `engine.ts` + `claude-code.ts`

**Files:**
- Modify: `src/shared/engine.ts`
- Modify: `src/shared/claude-code.ts`
- Test: `test/engine-selection.test.ts`

**Interfaces:**
- Consumes: registry (`selectEngine`, `createComplete`), `loadEngineConfig`.
- Produces (from `engine.ts`, keeping existing exports working):
  - `ENGINE_ENV = 'INSTAGUI_ENGINE'` (unchanged)
  - `interface EngineSelection { engine: string; reason: string; complete: CompleteFn }`
  - `resolveEngineSelection(opts: { flag?: string; configDir?: string }, deps?: SelectDeps): EngineSelection`
  - `resolveComplete(): CompleteFn` — **back-compat**: builds a selection from env only and returns its `complete` (so `core/extract.ts`'s existing `opts.complete ?? resolveComplete()` keeps working).
  - `activeEngineName(): string` (unchanged signature; now returns the resolved engine name)
- `claude-code.ts` becomes a thin re-export: `export { extractJsonText } from './engines/structured.js'` and `export const completeViaClaudeCode = createCliComplete(BUILTIN_ENGINES.claude)` (preserves the symbol some tests/import sites may use).

- [ ] **Step 1: Write the failing test**

Create `test/engine-selection.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEngineSelection } from '../src/shared/engine.js';

test('resolveEngineSelection: flag wins and yields a callable complete', () => {
  const sel = resolveEngineSelection(
    { flag: 'ollama', configDir: '/nonexistent-dir-xyz' },
    { env: {}, onPath: () => false },
  );
  assert.equal(sel.engine, 'ollama');
  assert.equal(typeof sel.complete, 'function');
});

test('resolveEngineSelection: env INSTAGUI_ENGINE=claude-code resolves to claude', () => {
  const sel = resolveEngineSelection(
    { configDir: '/nonexistent-dir-xyz' },
    { env: { INSTAGUI_ENGINE: 'claude-code' }, onPath: () => true },
  );
  assert.equal(sel.engine, 'claude');
});

test('resolveEngineSelection: key-only env picks anthropic (today\'s behavior)', () => {
  const sel = resolveEngineSelection(
    { configDir: '/nonexistent-dir-xyz' },
    { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => false },
  );
  assert.equal(sel.engine, 'anthropic');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/engine-selection.test.ts`
Expected: FAIL — `resolveEngineSelection` is not exported.

- [ ] **Step 3: Rewrite `src/shared/engine.ts`**

```ts
// src/shared/engine.ts — engine selection entry point. Resolves which AI engine extraction
// uses (from --engine flag, INSTAGUI_ENGINE, ~/.instagui/config.json, or auto-detect) and
// hands back a CompleteFn. Keeps ENGINE_ENV + a no-arg resolveComplete() for back-compat with
// core/extract.ts's `opts.complete ?? resolveComplete()`.
import type { CompleteFn } from './claude.js';
import { loadEngineConfig } from './engines/config.js';
import { selectEngine, createComplete, type SelectDeps } from './engines/registry.js';

export const ENGINE_ENV = 'INSTAGUI_ENGINE';

export interface EngineSelection {
  engine: string;
  reason: string;
  complete: CompleteFn;
}

/** Resolve the full engine selection. `flag` is the --engine value; env + PATH come via deps
 *  (defaults to the real process env). configDir is injectable for tests. */
export function resolveEngineSelection(
  opts: { flag?: string; configDir?: string } = {}, deps: SelectDeps = {},
): EngineSelection {
  const env = deps.env ?? process.env;
  const config = loadEngineConfig(opts.configDir);
  const { engine, reason } = selectEngine(
    { flag: opts.flag, envName: env[ENGINE_ENV], config }, deps,
  );
  return { engine: engine.name, reason, complete: createComplete(engine, deps) };
}

/** Back-compat: env-only resolution returning just the CompleteFn. */
export function resolveComplete(): CompleteFn {
  return resolveEngineSelection().complete;
}

/** Back-compat diagnostic name. */
export function activeEngineName(): string {
  try {
    return resolveEngineSelection().engine;
  } catch {
    return 'unresolved';
  }
}
```

- [ ] **Step 4: Rewrite `src/shared/claude-code.ts` as a thin re-export**

```ts
// src/shared/claude-code.ts — retained for back-compat. The subscription-CLI logic now lives
// in engines/cli.ts; this re-exports the pieces older import sites referenced.
import { BUILTIN_ENGINES } from './engines/builtins.js';
import { createCliComplete } from './engines/cli.js';
import type { CompleteFn } from './claude.js';

export { extractJsonText } from './engines/structured.js';

/** The `claude -p` completion, now the built-in `claude` CLI engine. Dev/test convenience. */
export const completeViaClaudeCode: CompleteFn = createCliComplete(BUILTIN_ENGINES.claude);
```

- [ ] **Step 5: Update any now-broken imports**

Run: `npm run build`
Expected: PASS. If `test/` files imported `claudeCodeModel`/`composePrompt`/`runClaude` (removed internals), update them to use the new `engines/cli.ts` API (`buildCliArgv`) or delete the now-duplicated assertions — the behavior is covered by `test/engines-cli.test.ts`. List and fix each compile error before continuing.

- [ ] **Step 6: Run the selection tests + full suite**

Run: `node --import tsx --test test/engine-selection.test.ts`
Expected: PASS (3 tests).
Run: `npm test`
Expected: PASS (all suites, including pre-existing extract/resolve/compose/server tests).

- [ ] **Step 7: Commit**

```bash
git add src/shared/engine.ts src/shared/claude-code.ts test/engine-selection.test.ts
git commit -m "refactor(engines): route resolveComplete through the registry (back-compat kept)"
```

---

## Task 9: Wire `--engine` + `--engines` into the CLI

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/core/onboarding.ts`
- Test: `test/cli-meta.test.ts` (extend existing)

**Interfaces:**
- Consumes: `resolveEngineSelection`, `buildRegistry`, `describeEngines`, `loadEngineConfig`.
- Produces: CLI behavior — new `--engine <name>` flag; `instagui --engines` listing; extraction uses the selected engine's `CompleteFn`; a stderr diagnostic naming the engine + reason.

- [ ] **Step 1: Write the failing test**

Add to `test/cli-meta.test.ts` (new cases; keep existing ones):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, describeEngines } from '../src/shared/engines/registry.js';

test('describeEngines includes anthropic + a cli + an openai-compatible engine', () => {
  const rows = describeEngines(buildRegistry({ engines: {} }), { env: {}, onPath: () => false });
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('anthropic'));
  assert.ok(names.includes('claude'));
  assert.ok(names.includes('openai'));
});
```

(The `--engine`/`--engines` wiring in `main()` is integration-level; it is validated by the
`describeEngines`/`resolveEngineSelection` unit tests above plus the manual smoke test in Step 6.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/cli-meta.test.ts`
Expected: FAIL — new assertion references `describeEngines` (already implemented Task 7) but the file may not import it yet; add the import. If it passes immediately, that is fine — proceed.

- [ ] **Step 3: Extend `parseArgs` options and add `--engines` + `--engine` handling in `src/cli/index.ts`**

In the `options` object inside `main()`, add:

```ts
      engine: { type: 'string' },
      engines: { type: 'boolean' },
```

Immediately after the `values.version` block, add the `--engines` listing:

```ts
  if (values.engines) {
    const { buildRegistry, describeEngines } = await import('../shared/engines/registry.js');
    const { loadEngineConfig } = await import('../shared/engines/config.js');
    const rows = describeEngines(buildRegistry(loadEngineConfig()));
    console.log('Available instagui AI engines (● = ready now):\n');
    for (const r of rows) {
      console.log(`  ${r.available ? '●' : '○'} ${r.name.padEnd(10)} ${r.kind.padEnd(18)} ${r.detail}`);
    }
    console.log('\nSelect with --engine <name>, INSTAGUI_ENGINE=<name>, or a "default" in ~/.instagui/config.json.');
    return 0;
  }
```

- [ ] **Step 4: Replace the `extract` closure's engine wiring**

Replace the current `usingClaudeCode`/`resolveComplete` logic. Change the top-of-file imports:

```ts
// remove: import { activeEngineName, ENGINE_ENV } from '../shared/engine.js';
import { resolveEngineSelection } from '../shared/engine.js';
```

Replace the `const extract = async () => { ... }` body so it resolves the engine once and injects its `complete`:

```ts
  const extract = async () => {
    const { helpText, source } = await resolveHelpText(tool, values['help-file'], values.capture ?? false);
    console.error(`instagui: help from ${source}`);
    if (helpText.trim().length === 0) {
      throw new PreconditionError(
        `No help text provided for "${tool}" (${source}). Pass --help-file <path> or pipe the tool's help output on stdin.`,
      );
    }
    // Resolve the AI engine (throws a friendly PreconditionError if none is usable).
    const selection = resolveEngineSelection({ flag: values.engine });
    console.error(`instagui: extracting via ${selection.engine} (${selection.reason})`);
    const { schema } = await extractSchema(helpText, tool, { model: values.model, complete: selection.complete });
    return schema;
  };
```

(Delete the now-unused `usingClaudeCode`, `hasApiKey`, `apiKeyOnboardingError`, and
`activeEngineName` references from this file — the engine layer now owns key/readiness checks
and its own diagnostics. Keep the `import` of `PreconditionError`.)

- [ ] **Step 5: Update `USAGE` text and `onboarding.ts`**

In `USAGE`, under Options add:

```
  --engine <name>      AI engine: anthropic | openai | google | ollama | claude | codex | gemini
                       | any engine in ~/.instagui/config.json. Default: auto-detect.
  --engines            list available engines and whether each is ready, then exit
```

And update the closing note line from the ANTHROPIC-only wording to:

```
Extraction uses your selected AI engine (--engine / INSTAGUI_ENGINE / ~/.instagui/config.json /
auto-detect). Run `instagui --engines` to see options. Exit codes: 0 ok · 2 known failure · 1 unexpected.
```

In `src/core/onboarding.ts`, extend the final `Tip:` line of `apiKeyOnboardingError()` to add:

```ts
      `\nOr use a subscription CLI instead of a key: install & sign into one, then run ` +
      `\`instagui <tool> --engine claude\` (or codex / gemini). See \`instagui --engines\`.`,
```

Then run `node --import tsx --test test/key-onboarding.test.ts`. If it asserts the message with
`assert.equal` on exact text, relax those assertions to `assert.match` on the stable substrings
(`ANTHROPIC_API_KEY`, `console.anthropic.com`) so the appended sentence doesn't break them.

- [ ] **Step 6: Build, lint, run the suite, and smoke-test**

Run: `npm run build && npm run lint && npm test`
Expected: all PASS.

Manual smoke (no key needed — bundled tool still bypasses the engine entirely):

```bash
npx tsx src/cli/index.ts --engines           # lists engines with ●/○ readiness
npx tsx src/cli/index.ts ffmpeg --print       # bundled → resolves with NO engine call
INSTAGUI_ENGINE=claude-code npx tsx src/cli/index.ts --engines  # still valid (alias)
```

Expected: `--engines` prints the table; `ffmpeg --print` prints the bundled Schema JSON with no engine diagnostic (extraction tier never reached).

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts src/core/onboarding.ts test/cli-meta.test.ts
git commit -m "feat(cli): --engine selection, --engines listing, engine diagnostics"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/development-guide.md`, `docs/architecture.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Choosing an AI engine" section to `README.md`**

After the Quick start section, add a section covering: the default auto-detect (set an API key OR log into a CLI); `--engine <name>`; the built-in engine names; a `~/.instagui/config.json` example (copy the §4 block from the spec, incl. `kimi` + `ollama`); and the "a set API key wins, else CLI" rule with the one-line override. State that the bundled demo tools still need no engine at all.

- [ ] **Step 2: Update `docs/architecture.md` "The AI seam (AD-3)" subsection**

Replace the SDK-vs-claude-code description with the engine registry model: three adapter kinds (`anthropic`/`openai-compatible`/`cli`), config-driven registry in `src/shared/engines/`, selection precedence, and that `core/extract.ts` is unchanged (still validates + retries regardless of engine). Link to the spec at `docs/superpowers/specs/2026-07-09-multi-engine-ai-design.md`.

- [ ] **Step 3: Update `docs/development-guide.md`**

Replace the "Dev engine (extract without an API key)" note: `INSTAGUI_ENGINE=claude-code` still works (alias for `--engine claude`); document `--engine`, `--engines`, and `~/.instagui/config.json`. Note the new env keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, …) are read only by the engine that references them.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md docs/development-guide.md
git commit -m "docs: document multi-engine AI selection + config"
```

---

## Final verification

- [ ] **Full suite green:** `npm run build && npm run lint && npm test` — all PASS.
- [ ] **Back-compat spot-check:** with only `ANTHROPIC_API_KEY` set and no CLIs, `instagui <newtool> --print` behaves exactly as before (anthropic engine, `claude-haiku-4-5`).
- [ ] **Boundary intact:** `test/eslint-dep-rule.test.ts` passes (engines are in `shared/`, no upward imports).
- [ ] **PR:** open `feat/multi-engine-ai` → `main` with a summary linking the spec; confirm the diff is feature-only (no `.bmad-loop/`, `_bmad/`, `.claude/`).
