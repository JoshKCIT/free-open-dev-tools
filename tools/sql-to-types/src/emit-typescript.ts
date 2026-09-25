import type { TableDef, TypeKind } from './parse';
import type { Dialect } from './parse';

const TS_TYPE: Record<TypeKind, string> = {
  int: 'number',
  bigint: 'string',
  decimal: 'string',
  float: 'number',
  boolean: 'boolean',
  string: 'string',
  datetime: 'Date',
  json: 'unknown',
  bytes: 'Uint8Array',
  unknown: 'unknown',
};

function pascalCase(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return 'Table';
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
}

function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Renders one `export interface` per table. `datetime` becomes TypeScript's
 * `Date` everywhere except SQLite, which has no native date/time storage
 * class of its own (SQLite's own docs: dates are kept as TEXT, REAL or
 * INTEGER), so this package's SQLite output keeps a datetime column as
 * `string` instead of implying a `Date` object that was never constructed.
 */
export function emitTypeScript(tables: TableDef[], dialect: Dialect): string {
  const seenNames = new Set<string>();
  const blocks = tables.map((table) => {
    let name = pascalCase(table.name);
    while (seenNames.has(name)) name += 'Table';
    seenNames.add(name);

    const lines = table.columns.map((col) => {
      const propName = isValidIdentifier(col.name) ? col.name : JSON.stringify(col.name);
      let tsType = col.typeKind === 'datetime' && dialect === 'sqlite' ? 'string' : TS_TYPE[col.typeKind];
      if (col.nullable) tsType += ' | null';
      return `  ${propName}: ${tsType};`;
    });

    return `export interface ${name} {\n${lines.join('\n')}\n}`;
  });

  return blocks.join('\n\n') + '\n';
}
