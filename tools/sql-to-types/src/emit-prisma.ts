import type { TableDef, ColumnDef, TypeKind, Dialect } from './parse';

/**
 * Prisma provider name per dialect, from the Prisma Schema Reference's
 * datasource block documentation (this package's meta.json standards list):
 * "The following providers are available: sqlite postgresql mysql sqlserver
 * mongodb cockroachdb".
 */
const PROVIDERS: Record<Dialect, string> = {
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
  sqlserver: 'sqlserver',
};

const SCALAR: Record<TypeKind, string> = {
  int: 'Int',
  bigint: 'BigInt',
  decimal: 'Decimal',
  float: 'Float',
  boolean: 'Boolean',
  string: 'String',
  datetime: 'DateTime',
  json: 'Json',
  bytes: 'Bytes',
  unknown: 'Unsupported',
};

function pascalCase(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return 'Table';
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
}

function isValidPrismaIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Turns a column name into a valid Prisma field identifier, replacing anything not a letter/digit/underscore. */
function fieldIdentifier(name: string): string {
  if (isValidPrismaIdentifier(name)) return name;
  let out = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(out)) out = '_' + out;
  return out === '' ? '_field' : out;
}

function defaultAttribute(col: ColumnDef): string {
  if (col.autoIncrement) return ' @default(autoincrement())';
  if (!col.default) return '';
  if (col.default.kind === 'now') return ' @default(now())';
  const { valueType, value } = col.default;
  if (valueType === 'string') return ` @default("${(value ?? '').replace(/"/g, '\\"')}")`;
  if (valueType === 'number') return ` @default(${value})`;
  if (valueType === 'boolean') return ` @default(${(value ?? '').toLowerCase()})`;
  // A literal NULL default carries no information Prisma's own @default
  // attribute can express; the field's own `?` already allows null.
  return '';
}

function renderColumn(col: ColumnDef, useFieldLevelId: boolean): string {
  const fieldName = fieldIdentifier(col.name);
  const scalar =
    col.typeKind === 'unknown' ? `Unsupported("${col.rawType}")` : SCALAR[col.typeKind] + (col.nullable ? '?' : '');
  const attrs: string[] = [];
  if (col.primaryKey && useFieldLevelId) attrs.push('@id');
  const mapAttr = fieldName !== col.name ? ` @map("${col.name}")` : '';
  return `  ${fieldName} ${scalar}${attrs.length ? ' ' + attrs.join(' ') : ''}${defaultAttribute(col)}${mapAttr}`;
}

/**
 * Renders a `datasource db` block, then one Prisma `model` per table. Field
 * names that are not valid Prisma identifiers are sanitized and kept
 * recoverable with `@map`; the model name is PascalCase with `@@map` back
 * to the original table name whenever it differs, which is effectively
 * always, since a snake_case or lowercase SQL table name almost never
 * matches Prisma's own PascalCase model-naming convention exactly.
 */
export function emitPrisma(tables: TableDef[], dialect: Dialect): string {
  const datasource = `datasource db {\n  provider = "${PROVIDERS[dialect]}"\n  url      = env("DATABASE_URL")\n}\n`;

  const seenNames = new Set<string>();
  const models = tables.map((table) => {
    let modelName = pascalCase(table.name);
    while (seenNames.has(modelName)) modelName += 'Table';
    seenNames.add(modelName);

    const compositeKey = table.columns.filter((c) => c.primaryKey);
    const useFieldLevelId = compositeKey.length <= 1;
    const lines = table.columns.map((c) => renderColumn(c, useFieldLevelId));

    const mapAttr = modelName !== table.name ? `\n  @@map("${table.name}")` : '';
    const idAttr =
      compositeKey.length > 1 ? `\n  @@id([${compositeKey.map((c) => fieldIdentifier(c.name)).join(', ')}])` : '';

    return `model ${modelName} {\n${lines.join('\n')}${idAttr}${mapAttr}\n}`;
  });

  return datasource + '\n' + models.join('\n\n') + '\n';
}
