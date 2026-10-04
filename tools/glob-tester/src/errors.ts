/**
 * A refusal of what was pasted. The message says what is wrong and where (a line number), and never repeats any of the
 * pasted text, so it can be shown, copied or logged by someone else without leaking a path or a pattern.
 */
export class GlobTesterError extends Error {
  /** The pasted line the problem is on, counting every line (blank ones too). Absent when no single line is to blame. */
  readonly line?: number;
  /** Which of the two pasted texts the problem is in. */
  readonly part: 'patterns' | 'paths';

  constructor(message: string, part: 'patterns' | 'paths', line?: number) {
    super(message);
    this.name = 'GlobTesterError';
    this.part = part;
    if (line !== undefined) this.line = line;
  }
}
