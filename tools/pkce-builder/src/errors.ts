/**
 * A refusal of what was typed or pasted. The message says what is wrong and which part of the input it is in, and never
 * repeats typed text, so it can be shown, copied or logged by someone else without leaking a verifier, a state or a code.
 */
export class PkceBuilderError extends Error {
  /** Which part of the input the problem is in. */
  readonly part: PkceBuilderPart;

  constructor(message: string, part: PkceBuilderPart) {
    super(message);
    this.name = 'PkceBuilderError';
    this.part = part;
  }
}

export type PkceBuilderPart = 'verifier' | 'endpoint' | 'redirect uri' | 'scope' | 'redirect' | 'length';
