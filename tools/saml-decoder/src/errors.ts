/**
 * A refusal of what was pasted. The message says what is wrong and where, and never repeats pasted text or the words of the
 * XML reader, so it can be shown, copied or logged by someone else without leaking a message.
 */
export class SamlDecoderError extends Error {
  /** Which input the problem is in: the pasted message, or the time that was typed. */
  readonly part: SamlDecoderPart;
  /** The 1-based line the problem is on, when there is one. */
  readonly line?: number;
  /** The 1-based column the problem is at, when there is one. */
  readonly column?: number;

  constructor(message: string, part: SamlDecoderPart, line?: number, column?: number) {
    super(message);
    this.name = 'SamlDecoderError';
    this.part = part;
    if (line !== undefined) this.line = line;
    if (column !== undefined) this.column = column;
  }
}

export type SamlDecoderPart = 'message' | 'time';
