/** The one error every refusal in this package is thrown as, so a page can show its message and where it happened. */
export class DataConvertError extends Error {
  /** Set for a JSON, YAML, TOML, XML, CSV or TSV syntax error or a row of the wrong width (line, and column where known). */
  readonly line?: number;
  readonly column?: number;
  /** RFC 6901 pointer, set instead of line/column for a structural problem such as a null on the way to TOML. */
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'DataConvertError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}
