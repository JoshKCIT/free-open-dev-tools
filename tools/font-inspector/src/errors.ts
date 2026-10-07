/**
 * The one error class this package throws. The message is always a fixed sentence that names a field or a byte offset,
 * never a piece of the font: a refusal must be safe to show on a page, so it is built from numbers and fixed words only.
 */
export class FontInspectorError extends Error {
  /** The label of the field the page should point at (for example `File` or `Font number in a collection`). */
  readonly field?: string;
  /** The offset of the byte at fault, when there is one. */
  readonly offset?: number;

  constructor(message: string, field?: string, offset?: number) {
    super(offset === undefined ? message : `${message} (at byte ${offset})`);
    this.name = 'FontInspectorError';
    if (field !== undefined) this.field = field;
    if (offset !== undefined) this.offset = offset;
  }
}

/**
 * Thrown by a guarded engine call (see `guardEngine`) when the browser refused the run-time code generation the WOFF2
 * engine needs while it started. It never reaches a page: the unpacking and packing steps turn it into their own sentence.
 */
export class EngineRefusedError extends Error {
  constructor() {
    super('The browser refused the run-time code generation the WOFF2 engine needs while it started.');
    this.name = 'EngineRefusedError';
  }
}
