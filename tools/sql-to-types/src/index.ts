import meta from './meta.json';
import { SqlSyntaxError } from './tokenize';
import { parseCreateTableStatements, type Dialect, type TableDef, type NotConverted } from './parse';
import { emitTypeScript } from './emit-typescript';

export { meta };
export type { Dialect, TableDef, NotConverted };

export type Target = 'typescript';

export class SqlToTypesError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SqlToTypesError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface SqlToTypesOptions {
  dialect?: Dialect;
  target?: Target;
}

export interface SqlToTypesResult {
  output: string;
  tables: TableDef[];
  notConverted: NotConverted[];
}

/**
 * Parses one or more CREATE TABLE statements from the documented subset
 * (columns, types, NULL/NOT NULL, primary keys, defaults) and renders the
 * chosen target. Anything outside that subset is listed in `notConverted`
 * with its line, never guessed at.
 */
export function sqlToTypes(sql: string, options: SqlToTypesOptions = {}): SqlToTypesResult {
  const dialect = options.dialect ?? 'postgresql';
  const target = options.target ?? 'typescript';

  if (!sql.trim()) throw new SqlToTypesError('The input is empty.');

  let parsed;
  try {
    parsed = parseCreateTableStatements(sql);
  } catch (err) {
    if (err instanceof SqlSyntaxError) throw new SqlToTypesError(err.message, { line: err.line, column: err.column });
    throw err;
  }

  if (parsed.tables.length === 0) {
    throw new SqlToTypesError('No CREATE TABLE statement in the documented subset was found in this input.');
  }

  let output: string;
  if (target === 'typescript') {
    output = emitTypeScript(parsed.tables, dialect);
  } else {
    throw new SqlToTypesError(`Unknown target "${target}".`);
  }

  return { output, tables: parsed.tables, notConverted: parsed.notConverted };
}
