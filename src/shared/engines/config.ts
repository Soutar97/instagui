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
