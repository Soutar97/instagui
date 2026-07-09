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
