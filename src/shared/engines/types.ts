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
