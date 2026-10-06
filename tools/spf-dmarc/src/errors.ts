/**
 * A refusal of what was typed or pasted. The message says what is wrong and which box it is in, and never repeats typed
 * text, so it can be shown, copied or logged by someone else without leaking a record.
 */
export class SpfDmarcError extends Error {
  /** Which part of the input the problem is in. */
  readonly part: SpfDmarcPart;
  /** The 1-based character position the problem starts at, when there is one. */
  readonly position?: number;

  constructor(message: string, part: SpfDmarcPart, position?: number) {
    super(message);
    this.name = 'SpfDmarcError';
    this.part = part;
    if (position !== undefined) this.position = position;
  }
}

export type SpfDmarcPart = 'spf' | 'dmarc' | 'domain' | 'builder';
