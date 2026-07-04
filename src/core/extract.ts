// core/extract.ts — the AI bet, isolated. Help text in → validated Schema out.
// Flow: build prompt → ask Claude for JSON matching the Schema → Schema.parse().
// On malformed output: exactly one retry, then write the raw output to a debug file and
// fail with a clear precondition error (exit 2). No server, no UI here.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Schema } from './schema.js';
import { PreconditionError } from './errors.js';
import type { CompletionRequest, ClaudeClient, CompleteFn } from '../shared/claude.js';
import { resolveComplete } from '../shared/engine.js';

/** Locked decision: extraction model. */
export const DEFAULT_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You extract a machine-usable description of a command-line tool's interface from its --help text, matching the provided JSON schema exactly.

Rules — follow all of them:
1. GROUND EVERY FLAG IN THE HELP. Only include options whose flag appears verbatim in the help text. Never invent, guess, complete, or "improve" a flag. If you are unsure a flag exists, omit it. A hallucinated flag is worse than a missing one.
2. THE TOOL IS FLAT — no subcommands. If the help lists sub-commands, verbs, or usage examples (e.g. "tool build", "tool run"), do NOT model them as a tree and do NOT invent per-subcommand options. Extract only the tool's own top-level options and positional arguments.
3. SHORT-ONLY FLAGS COUNT. If an option has only a short form (e.g. "-x" with no long form), capture it exactly. Never drop an option for lacking a "--long" form. Put the flag text exactly as written in "flag" (include every form shown, e.g. "-c, --codec").
4. HUGE HELP: if the tool exposes hundreds of options (codec/format dumps, etc.), extract the generally useful options a person would set from the main option sections. You may omit exhaustive rare entries. Coverage of the common, task-relevant options matters more than completeness.
5. POSITIONALS ARE FIRST-CLASS. Capture positional arguments (input/output files, etc.) in "positionals", not as flags. Infer "required" and "variadic" from the usage line ("<output>" is required; "[file...]" is variadic and optional).
6. TYPES: use "boolean" for switches that take no value; "enum" when the help lists a fixed set of allowed values (put them in "enumValues"); "number" for numeric values; "path" for file/directory/path values; "string" otherwise. "enumValues" is [] unless the type is "enum".
7. "group" is the help section header the option sits under (e.g. "Video options"); "" if none. "description" is a concise one-line description from the help, or "" if none.
8. "tool" must echo the tool name given by the user exactly. "summary" is a one-line description of the tool if the help states one, else "".`;

export function buildUserPrompt(helpText: string, tool: string): string {
  return `Tool: ${tool}\n\nHelp text:\n"""\n${helpText}\n"""`;
}

export type { CompleteFn };

export interface ExtractOptions {
  model?: string;
  maxTokens?: number;
  /** Injected completion fn (tests). */
  complete?: CompleteFn;
  /** Injected Claude client, passed through to `complete`. */
  client?: ClaudeClient;
  /** Directory for the debug artifact on post-retry failure. Defaults to cwd. */
  debugDir?: string;
  /** Timestamp for a deterministic debug filename (tests). Defaults to Date.now(). */
  now?: number;
}

export interface ExtractResult {
  schema: Schema;
  /** How many model calls it took (1 or 2). */
  attempts: number;
}

/**
 * Extract a validated Schema from help text. Exactly one retry on malformed output; on a
 * second failure the raw model output is written to a debug file (path carried on the
 * thrown PreconditionError) and never discarded.
 */
export async function extractSchema(
  helpText: string,
  tool: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const completeFn = opts.complete ?? resolveComplete();
  const req: CompletionRequest = {
    model: opts.model ?? DEFAULT_MODEL,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(helpText, tool),
    outputSchema: Schema,
    maxTokens: opts.maxTokens,
  };

  const maxAttempts = 2; // initial + exactly one retry
  let lastRaw = '';
  let lastReason = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastRaw = await completeFn(req, opts.client);
    const outcome = validate(lastRaw);
    if (outcome.ok) {
      return { schema: outcome.schema, attempts: attempt };
    }
    lastReason = outcome.reason;
  }

  // Both attempts failed — persist the invalid output for prompt tuning, then fail clearly.
  const debugFile = writeDebugFile(lastRaw, tool, lastReason, opts);
  throw new PreconditionError(
    `Extraction failed: the model did not return a valid Schema for "${tool}" after one retry (${lastReason}). ` +
      `The invalid output was saved to ${debugFile} for inspection.`,
    debugFile,
  );
}

type ValidateOutcome = { ok: true; schema: Schema } | { ok: false; reason: string };

function validate(raw: string): ValidateOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `response was not valid JSON: ${(e as Error).message}` };
  }
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `response did not match the Schema shape: ${parsed.error.message}` };
  }
  return { ok: true, schema: parsed.data };
}

function writeDebugFile(raw: string, tool: string, reason: string, opts: ExtractOptions): string {
  const dir = opts.debugDir ?? process.cwd();
  const ts = opts.now ?? Date.now();
  const file = path.join(dir, `guiup-debug-${tool.replace(/[^\w.-]/g, '_')}-${ts}.json`);
  const body = JSON.stringify({ tool, reason, rawOutput: raw }, null, 2);
  writeFileSync(file, body, 'utf8');
  return file;
}
