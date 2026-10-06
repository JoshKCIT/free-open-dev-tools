/**
 * A refusal of what was described or pasted. The message says what is wrong and where (the part and a line number), and
 * never repeats any of the pasted text, so it can be shown, copied or logged by someone else without leaking an address, a
 * token or a cookie.
 */
export class CorsCheckerError extends Error {
  /** The pasted line the problem is on, counting every line (blank ones too). Absent when no single line is to blame. */
  readonly line?: number;
  /** Which part of the description the problem is in. */
  readonly part: CorsCheckerPart;

  constructor(message: string, part: CorsCheckerPart, line?: number) {
    super(message);
    this.name = 'CorsCheckerError';
    this.part = part;
    if (line !== undefined) this.line = line;
  }
}

export type CorsCheckerPart =
  'url' | 'page origin' | 'method' | 'request headers' | 'preflight headers' | 'response headers';
