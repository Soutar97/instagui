// core/capture.ts — Story 1.2. Capture a tool's help text via the fallback chain
// (--help → -h → help → man), reading BOTH stdout and stderr, under a timeout and an
// output-size cap so a misbehaving tool can't hang the launch. Output feeds the existing
// extractor unchanged.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ToolNotFoundError, NoHelpError } from './errors.js';

/** Pinned capture limits (PRD §9 / spine). */
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 1_000_000; // 1MB

const DEFAULT_ARG_SETS = [['--help'], ['-h'], ['help']];

export interface RunLimits {
  timeoutMs: number;
  maxBytes: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Killed because it exceeded the time limit. */
  timedOut: boolean;
  /** Killed because combined output hit the byte cap (truncated but usable). */
  capped: boolean;
  /** Present when the process could not be spawned (e.g. ENOENT = not on PATH). */
  spawnError?: NodeJS.ErrnoException;
}

/** Injectable process runner — real spawn by default, a fake in tests. */
export type RunFn = (cmd: string, args: string[], limits: RunLimits) => Promise<RunOutcome>;

export interface CaptureOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Override the argument fallback sequence (tests). */
  argSets?: string[][];
  /** Whether to try `man <tool>` as a last resort. Default true. */
  tryMan?: boolean;
  runner?: RunFn;
}

export interface CaptureResult {
  helpText: string;
  /** How help was obtained: "--help", "-h", "help", or "man". */
  method: string;
}

/** Candidate executable names to try. On Windows, resolve extensionless names against
 *  common executable extensions (spawn without a shell does not append PATHEXT). */
function candidates(tool: string): string[] {
  if (process.platform !== 'win32') return [tool];
  if (path.extname(tool)) return [tool];
  return [`${tool}.exe`, `${tool}.com`, tool];
}

/** Merge a run's streams into one help-text blob (help may land on either stream). */
function combine(o: RunOutcome): string {
  const parts = [o.stdout, o.stderr].filter((s) => s.trim().length > 0);
  return parts.join('\n');
}

/** Decide whether captured text is real help vs an error about the flag we passed. */
export function isUsableHelp(text: string): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  const firstLine = t.split('\n', 1)[0] ?? '';
  if (/\b(unknown|unrecognized|invalid|illegal|no such)\b.*\b(option|flag|argument|command)\b/i.test(firstLine)) {
    return false;
  }
  return true;
}

/** Remove man's backspace overstrike sequences (bold/underline) so extraction sees
 *  plain text. */
export function stripManFormatting(s: string): string {
  return s.replace(/.\x08/g, '');
}

/**
 * Capture help text for `tool`. Throws ToolNotFoundError if the tool isn't on PATH, or
 * NoHelpError if every fallback failed to yield usable help. Both surface as clear
 * messages (exit 2 via PreconditionError) — never a hang.
 */
export async function captureHelp(tool: string, opts: CaptureOptions = {}): Promise<CaptureResult> {
  const run = opts.runner ?? defaultRun;
  const limits: RunLimits = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
  };
  const argSets = opts.argSets ?? DEFAULT_ARG_SETS;
  const cmds = candidates(tool);

  let resolvedCmd: string | null = null;
  let lastReason = '';

  for (let i = 0; i < argSets.length; i++) {
    const args = argSets[i]!;

    // First probe also resolves which executable name actually runs. If none of the
    // candidates can be spawned at all, the tool is not on PATH.
    let outcome: RunOutcome;
    if (resolvedCmd === null) {
      let resolvedOutcome: RunOutcome | null = null;
      for (const c of cmds) {
        const o = await run(c, args, limits);
        if (o.spawnError?.code === 'ENOENT') continue;
        resolvedCmd = c;
        resolvedOutcome = o;
        break;
      }
      if (resolvedCmd === null || resolvedOutcome === null) {
        throw new ToolNotFoundError(tool);
      }
      outcome = resolvedOutcome;
    } else {
      outcome = await run(resolvedCmd, args, limits);
    }

    if (outcome.spawnError) {
      lastReason = `spawn error (${outcome.spawnError.code ?? 'unknown'})`;
      continue;
    }
    if (outcome.timedOut) {
      lastReason = `timed out after ${limits.timeoutMs}ms`;
      continue;
    }
    const text = combine(outcome);
    if (isUsableHelp(text)) {
      return { helpText: text, method: args.join(' ') };
    }
    lastReason = outcome.capped
      ? 'output cap reached before usable help appeared'
      : `no usable help (exit ${outcome.code})`;
  }

  // Last resort: man page.
  if (opts.tryMan !== false) {
    const manText = await tryMan(tool, run, limits);
    if (manText) return { helpText: manText, method: 'man' };
  }

  throw new NoHelpError(tool, lastReason || 'all fallbacks failed');
}

async function tryMan(tool: string, run: RunFn, limits: RunLimits): Promise<string | null> {
  const o = await run('man', [tool], {
    ...limits,
    env: { ...process.env, MANPAGER: 'cat', PAGER: 'cat', MANWIDTH: '80' },
  });
  if (o.spawnError || o.timedOut) return null;
  const text = stripManFormatting(combine(o)).trim();
  return isUsableHelp(text) ? text : null;
}

/** Real runner: spawn (no shell → args-array only), read both streams into a capped
 *  buffer, kill on timeout or byte-cap. */
function defaultRun(cmd: string, args: string[], limits: RunLimits): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: limits.env ?? process.env, windowsHide: true });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let total = 0;
    let timedOut = false;
    let capped = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, limits.timeoutMs);

    const settle = (code: number | null, spawnError?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code,
        timedOut,
        capped,
        spawnError,
      });
    };

    const append = (sink: Buffer[], chunk: Buffer) => {
      const remaining = limits.maxBytes - total;
      if (remaining <= 0) return;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      sink.push(slice);
      total += slice.length;
      if (total >= limits.maxBytes) {
        capped = true;
        child.kill('SIGKILL');
      }
    };

    child.stdout?.on('data', (c: Buffer) => append(out, c));
    child.stderr?.on('data', (c: Buffer) => append(err, c));
    child.on('error', (e) => settle(null, e as NodeJS.ErrnoException));
    child.on('close', (code) => settle(code));
  });
}
