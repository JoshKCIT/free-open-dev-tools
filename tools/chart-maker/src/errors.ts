/**
 * The one error this package throws on purpose. Its message is a plain sentence that names a row and a column (or a
 * limit) and never repeats any pasted text, so a page can show it as it is.
 */
export class ChartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartError';
  }
}
