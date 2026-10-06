/**
 * A refusal of what was pasted or chosen. The message says what is wrong and where (the part and a line number), and
 * never repeats any of the pasted text, so it can be shown, copied or logged by someone else without leaking a cookie.
 */
export class SetCookieInspectorError extends Error {
  /** The pasted line the problem is on, counting every line (blank ones too). Absent when no single line is to blame. */
  readonly line?: number;
  /** Which part of the input the problem is in. */
  readonly part: SetCookieInspectorPart;

  constructor(message: string, part: SetCookieInspectorPart, line?: number) {
    super(message);
    this.name = 'SetCookieInspectorError';
    this.part = part;
    if (line !== undefined) this.line = line;
  }
}

export type SetCookieInspectorPart = 'lines' | 'request url' | 'time';
