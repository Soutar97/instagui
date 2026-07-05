// server/run.ts — Story 3.3. Owns the single-run lifecycle: spawn the composed command with
// an arguments ARRAY (never a shell), forward stdout+stderr to a sink, report the exit code,
// and kill on Stop. Exactly one run in flight (AD-5): a second start is refused while one is
// live. The server ties the sink's lifetime to the SSE connection, so a disconnect that
// stops the sink also drives Stop → no orphaned child.
//
// spawn is injected so the controller is unit-testable with a fake child (no real process).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export type SpawnLike = typeof spawn;

export interface RunResult {
  /** Process exit code, or null if it was killed by a signal / failed to start. */
  code: number | null;
  /** Signal that terminated the process (e.g. "SIGTERM"), or null. */
  signal: NodeJS.Signals | null;
}

/** Where run output and completion are delivered. The server implements this over SSE. */
export interface RunSink {
  out(chunk: string): void;
  end(result: RunResult): void;
}

export type StartOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Single-run controller. `start` refuses while a run is live; `stop` terminates it
 * (SIGTERM, escalating to SIGKILL if ignored). Exactly one child at a time.
 */
export class RunController {
  private child: ChildProcess | null = null;
  private readonly spawnFn: SpawnLike;

  constructor(spawnFn: SpawnLike = spawn) {
    this.spawnFn = spawnFn;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** Spawn `cmd` with `args` (args array — no shell). Refuses if a run is already in flight. */
  start(cmd: string, args: string[], sink: RunSink): StartOutcome {
    if (this.child) return { ok: false, reason: 'a run is already in progress' };

    let child: ChildProcess;
    try {
      child = this.spawnFn(cmd, args, { shell: false, windowsHide: true });
    } catch (err) {
      return { ok: false, reason: `failed to start: ${(err as Error).message}` };
    }
    this.child = child;

    child.stdout?.on('data', (c: Buffer) => sink.out(c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => sink.out(c.toString('utf8')));

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.child !== child) return; // already finished (guards error+close double-fire)
      this.child = null;
      sink.end({ code, signal });
    };

    child.on('error', (err: Error) => {
      // Map the most common failure — ENOENT (binary missing) — to the same friendly wording
      // the CLI's ToolNotFoundError uses, instead of leaking a raw "spawn <tool> ENOENT".
      // Any other spawn error falls back to its message. Either way: surface, then end.
      const code = (err as NodeJS.ErrnoException).code;
      const msg =
        code === 'ENOENT'
          ? `instagui: "${cmd}" is not installed or not on your PATH.`
          : `instagui: failed to run command: ${err.message}`;
      sink.out(`${msg}\n`);
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));

    return { ok: true };
  }

  /** Kill the running child, if any. Returns whether there was one to kill. */
  stop(): boolean {
    const child = this.child;
    if (!child) return false;
    child.kill('SIGTERM');
    // Escalate if the child ignores SIGTERM. Timer is unref'd so it never holds the process.
    const timer = setTimeout(() => {
      if (this.child === child) child.kill('SIGKILL');
    }, 2000);
    timer.unref?.();
    return true;
  }
}
