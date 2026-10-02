/** Thrown when a grid cannot be written out (no cells, an unsupported format, or a cell the chosen format cannot hold). */
export class TableBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableBuilderError';
  }
}

/** Thrown when pasted text cannot be read as a table of the chosen kind. */
export class TableImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableImportError';
  }
}
