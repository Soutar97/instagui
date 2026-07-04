// Exit-code contract (spine): 0 ok · 2 known precondition failure (distinct messages) ·
// 1 unexpected. Core throws typed errors; the CLI maps them to process exit codes so the
// core stays testable and free of process.exit.

/** A known, user-facing precondition failure → exit code 2. Message is safe to print
 *  as-is (no stack trace). */
export class PreconditionError extends Error {
  readonly exitCode = 2;
  /** Path to a written debug artifact, when the failure produced one. */
  readonly debugFile?: string;

  constructor(message: string, debugFile?: string) {
    super(message);
    this.name = 'PreconditionError';
    this.debugFile = debugFile;
  }
}

// Capture failures — distinct types so Story 1.3 can route distinct messages/exit codes.
// All are precondition failures (exit 2); messages here are serviceable and refined in 1.3.

/** The named tool is not found on PATH. */
export class ToolNotFoundError extends PreconditionError {
  constructor(public readonly tool: string) {
    super(`Tool not found: "${tool}" is not on your PATH. Check the name and that it is installed.`);
    this.name = 'ToolNotFoundError';
  }
}

/** The tool ran but produced no usable help text through any fallback. */
export class NoHelpError extends PreconditionError {
  constructor(
    public readonly tool: string,
    public readonly detail?: string,
  ) {
    super(
      `No help output: "${tool}" produced no usable help via --help, -h, help, or man` +
        (detail ? ` (${detail})` : '') +
        `. Pass --help-file <path> or pipe help text on stdin.`,
    );
    this.name = 'NoHelpError';
  }
}

