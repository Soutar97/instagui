// AD-3 — a guiup-agnostic Claude client: prompt + output shape in, raw JSON text out.
// It knows nothing about Tools, Schemas, or Forms — it takes any zod object as the
// output shape and returns the model's raw JSON string. Callers run their own
// validation (core does Schema.parse), which keeps the invalid raw text available for
// debugging when validation fails.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod/v4';

export interface CompletionRequest {
  /** Model id, e.g. "claude-haiku-4-5". */
  model: string;
  system: string;
  user: string;
  /** The zod object the response must conform to; passed through zodOutputFormat so the
   *  API constrains output to matching JSON. */
  outputSchema: z.ZodType;
  /** Output cap. Non-streaming default stays well under the SDK HTTP timeout. */
  maxTokens?: number;
}

/** A minimal structural view of the SDK client — lets callers inject a fake in tests
 *  without depending on the concrete Anthropic class. */
export interface ClaudeClient {
  messages: {
    create(body: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

/**
 * Send one completion and return the raw assistant text (expected to be JSON, but
 * NOT validated here). Throws if the response carries no text block at all.
 *
 * @param client optional injected client; defaults to a real Anthropic() which reads
 *               ANTHROPIC_API_KEY from the environment.
 */
export async function complete(req: CompletionRequest, client?: ClaudeClient): Promise<string> {
  const anthropic: ClaudeClient = client ?? (new Anthropic() as unknown as ClaudeClient);

  const message = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    output_config: { format: zodOutputFormat(req.outputSchema) },
  });

  const text = message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  if (text.trim().length === 0) {
    throw new Error('Claude returned no text content.');
  }
  return text;
}

/** The completion seam every engine implements: prompt + output shape in, raw JSON
 *  text out. `complete` (SDK) is the primary implementation; the claude-code adapter is
 *  a dev-only alternative selected via GUIUP_ENGINE. */
export type CompleteFn = (req: CompletionRequest, client?: ClaudeClient) => Promise<string>;
