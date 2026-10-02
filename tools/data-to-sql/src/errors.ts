/** Thrown when input cannot be turned into SQL, or SQL cannot be read back into rows. Carries a 1-based position when one is known. */
export class DataToSqlError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'DataToSqlError';
    this.line = detail.line;
    this.column = detail.column;
  }
}
