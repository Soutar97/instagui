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
