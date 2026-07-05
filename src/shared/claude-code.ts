// DEV/TEST-ONLY extraction engine. Shells out to headless Claude Code (`claude -p`,
// subscription-authenticated) instead of the Anthropic API, so extraction can be
// exercised without an ANTHROPIC_API_KEY / API credits.
//
// It implements the SAME CompleteFn seam as shared/claude.ts and returns raw JSON text —
// the caller (core/extract.ts) still runs Schema.parse() + one-retry + debug-file, so the
// validation pipeline is identical to the SDK path.
//
// NOT a published requirement and NOT for user docs: it is inert unless INSTAGUI_ENGINE is
// set to "claude-code", the SDK path remains primary/default, and it depends on a `claude`
// binary that end users are not expected to have.
import { spawn } from 'node:child_process';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { CompletionRequest, CompleteFn } from './claude.js';

/** Map an API model id to a Claude Code `--model` alias where possible; otherwise pass it
 *  through. Subscription auth may override the selection — reported as a divergence. */
function claudeCodeModel(model: string): string {
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  return model;
}

/** Compose the single prompt piped to `claude -p`. Claude Code has no server-side schema
 *  enforcement, so the exact JSON Schema (derived from the same zod object) is appended
 *  with a JSON-only instruction. */
function composePrompt(req: CompletionRequest): string {
  const fmt = zodOutputFormat(req.outputSchema) as unknown as { schema: unknown };
  const jsonSchema = JSON.stringify(fmt.schema, null, 2);
  return (
    `${req.system}\n\n${req.user}\n\n` +
    `Respond with ONLY a single JSON object that conforms to this JSON Schema. ` +
    `No markdown, no code fences, no commentary before or after.\n\n` +
    `JSON Schema:\n${jsonSchema}`
  );
}

/** Pull the JSON object out of Claude Code's stdout. Transport-layer normalization only
 *  (fences / surrounding prose); it does NOT validate — that stays in the shared pipeline
 *  so malformed output still flows through retry + debug-file. */
export function extractJsonText(stdout: string): string {
  let s = stdout.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) return s.slice(first, last + 1);
  return s; // let JSON.parse fail downstream → retry → debug-file
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runClaude(args: string[], stdin: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // shell:true so a Windows `claude.cmd` shim resolves via PATHEXT. Args are simple
    // flags (no untrusted values); the prompt goes over stdin, never the command line.
    const child = spawn('claude', args, { shell: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** CompleteFn implemented over `claude -p`. Dev/test only. */
export const completeViaClaudeCode: CompleteFn = async (req: CompletionRequest): Promise<string> => {
  const prompt = composePrompt(req);
  const args = ['-p', '--model', claudeCodeModel(req.model)];
  const { stdout, stderr, code } = await runClaude(args, prompt, 180_000);

  if (code !== 0) {
    throw new Error(`claude -p exited with code ${code}: ${stderr.trim() || '(no stderr)'}`);
  }
  const json = extractJsonText(stdout);
  if (json.trim().length === 0) {
    throw new Error('claude -p returned empty output.');
  }
  return json;
};
