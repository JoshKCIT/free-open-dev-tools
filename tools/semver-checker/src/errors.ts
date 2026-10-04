/**
 * A refusal of what was pasted or typed. The message says what is wrong and, for a pasted version, which line it is on;
 * it never repeats any of the pasted text, so it can be shown, copied or logged by someone else without leaking a
 * version, a range or a package name. The library's own messages, which do repeat the text, are never passed through.
 */
export class SemverCheckerError extends Error {
  /** The pasted line the problem is on, counting every line (blank ones too). Absent when no single line is to blame. */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'SemverCheckerError';
    if (line !== undefined) this.line = line;
  }
}
