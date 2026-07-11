// src/shared/errors.ts — the exit-code contract's base error, in the leaf layer so shared/
// (and core/) can throw it without an upward import (AD-2). core/errors.ts re-exports it and
// adds the capture-specific subclasses.

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
