/**
 * A problem with what was pasted: a DOCTYPE, a well-formedness error, an entity that was never declared, or (in the
 * canonical and compare modes) a document over the size limit. `line` and `column` are 1-based when known; `part`
 * names which of two compared documents the problem is in.
 */
export class XmlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly part?: 'first' | 'second';

  constructor(message: string, detail: { line?: number; column?: number; part?: 'first' | 'second' } = {}) {
    super(message);
    this.name = 'XmlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
    if (detail.part) this.part = detail.part;
  }
}
