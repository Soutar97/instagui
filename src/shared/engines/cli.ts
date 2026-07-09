// src/shared/engines/cli.ts — the subscription CLI engine: shell out to a coding CLI
// (claude/codex/gemini, or `ollama` etc. via config) that is authenticated by the user's
// own login. Generalizes the former shared/claude-code.ts. Prompt goes over stdin
// (promptVia:'stdin') or as an argument (promptVia:'arg'); args are static flags only.
// The default runner spawns WITHOUT a shell (shell:false) — promptVia:'arg' engines put the
// (untrusted) prompt into argv, and a shell would interpret metacharacters in it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PreconditionError } from '../errors.js';
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

/** Resolve a binary to a concrete executable path via PATH (including Windows extensions), so
 *  we can spawn WITHOUT a shell. shell:true would let untrusted prompt text in argv
 *  (promptVia:'arg' — the prompt carries the target tool's --help text) break out via shell
 *  metacharacters. No shell → argv is passed verbatim, never interpreted. On POSIX a bare name
 *  also resolves via execvp, but we resolve explicitly so Windows finds a .cmd/.exe shim too. */
function resolveBinaryPath(binary: string): string {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, binary + ext);
      if (existsSync(full)) return full;
    }
  }
  return binary; // let spawn surface ENOENT if truly missing
}

/** Default runner: spawn WITHOUT a shell. Args are static flags; when promptVia:'stdin' the
 *  prompt never touches the command line, and when promptVia:'arg' it is passed as a verbatim
 *  argv element (never interpreted by a shell). */
const defaultRun: RunCli = (binary, argv, stdin, timeoutMs) =>
  new Promise((resolve, reject) => {
    // shell:false — the prompt may be an argv element (promptVia:'arg') and carries untrusted
    // help text; a shell would interpret metacharacters in it. No shell → argv passed verbatim.
    const child = spawn(resolveBinaryPath(binary), argv, { shell: false, windowsHide: true });
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
