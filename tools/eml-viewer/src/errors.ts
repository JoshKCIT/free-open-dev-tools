/**
 * A refusal of what was opened or pasted. The message is a fixed sentence that names the part and the limit, and never
 * repeats any text of the message, so it can be shown, copied or logged by someone else without leaking a message.
 */
export class EmlViewerError extends Error {
  /** Which input the problem is in. */
  readonly part: EmlViewerPart;

  constructor(message: string, part: EmlViewerPart) {
    super(message);
    this.name = 'EmlViewerError';
    this.part = part;
  }
}

export type EmlViewerPart = 'message' | 'file' | 'pasted message';
