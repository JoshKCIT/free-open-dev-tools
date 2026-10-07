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
