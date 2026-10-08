/** Which pasted field a refusal is about. */
export type ErrorField = 'messages' | 'separator' | 'currentVersion';

/**
 * A refusal of what was pasted. The message says what is wrong and where (a message number or a line number) and which
 * limit applies, and never repeats any of the pasted text, so it can be shown, copied or logged by someone else without
 * leaking a commit message. A commit message that is not valid is never a refusal: it is a result.
 */
export class ConventionalCommitError extends Error {
  /** The field the problem is in. */
  readonly field: ErrorField;
  /** The pasted line the problem is on, counting every line (blank ones too). Absent when no single line is to blame. */
  readonly line?: number;

  constructor(message: string, field: ErrorField = 'messages', line?: number) {
    super(message);
    this.name = 'ConventionalCommitError';
    this.field = field;
    if (line !== undefined) this.line = line;
  }
}
