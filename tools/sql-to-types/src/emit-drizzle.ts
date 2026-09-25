import type { TableDef, ColumnDef, Dialect } from './parse';

/**
 * drizzle-orm 0.45.3 has no SQL Server table builder at all (confirmed by
 * reading this package's own installed node_modules/drizzle-orm/package.json
 * exports map during planning: pg-core, mysql-core and sqlite-core are
 * present, no mssql-core), so this is the one dialect this target refuses
 * outright rather than guessing at a builder that does not exist.
 */
export class DrizzleUnsupportedDialectError extends Error {
  constructor(dialect: string) {
    super(`drizzle-orm 0.45.3 has no SQL Server table builder, so "${dialect}" cannot be converted to Drizzle.`);
    this.name = 'DrizzleUnsupportedDialectError';
  }
}

interface Builder {
  importName: string;
  call: string;
}

function esc(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Column type builders, one lookup per dialect, from each dialect's own
 * fetched Drizzle column-types page (this package's meta.json standards
 * list). Every call passes the original SQL column name as Drizzle's own
 * first constructor argument, so the generated column always maps back to
 * the exact name this document declared, regardless of the JS property
 * name chosen for it.
 */
function pgBuilder(col: ColumnDef): Builder {
  const n = esc(col.name);
  switch (col.typeKind) {
    case 'int':
      return col.autoIncrement
        ? { importName: 'serial', call: `serial('${n}')` }
        : { importName: 'integer', call: `integer('${n}')` };
    case 'bigint':
      return col.autoIncrement
        ? { importName: 'bigserial', call: `bigserial('${n}', { mode: 'bigint' })` }
        : { importName: 'bigint', call: `bigint('${n}', { mode: 'bigint' })` };
    case 'decimal':
      return { importName: 'numeric', call: `numeric('${n}')` };
    case 'float':
      return { importName: 'doublePrecision', call: `doublePrecision('${n}')` };
    case 'boolean':
      return { importName: 'boolean', call: `boolean('${n}')` };
    case 'string':
      return { importName: 'text', call: `text('${n}')` };
    case 'datetime':
      return { importName: 'timestamp', call: `timestamp('${n}')` };
    case 'json':
      return { importName: 'jsonb', call: `jsonb('${n}')` };
    case 'bytes':
      return { importName: 'bytea', call: `bytea('${n}')` };
    case 'unknown':
      throw new Error('unreachable: unknown-typed columns are filtered out before emission');
  }
}

function mysqlBuilder(col: ColumnDef): Builder {
  const n = esc(col.name);
  switch (col.typeKind) {
    case 'int':
      return { importName: 'int', call: `int('${n}')` };
    case 'bigint':
      return { importName: 'bigint', call: `bigint('${n}', { mode: 'bigint' })` };
    case 'decimal':
      return { importName: 'decimal', call: `decimal('${n}')` };
    case 'float':
      return { importName: 'double', call: `double('${n}')` };
    case 'boolean':
      return { importName: 'boolean', call: `boolean('${n}')` };
    case 'string':
      return { importName: 'text', call: `text('${n}')` };
    case 'datetime':
      return { importName: 'datetime', call: `datetime('${n}')` };
    case 'json':
      return { importName: 'json', call: `json('${n}')` };
    case 'bytes':
      return { importName: 'blob', call: `blob('${n}')` };
    case 'unknown':
      throw new Error('unreachable: unknown-typed columns are filtered out before emission');
  }
}

function sqliteBuilder(col: ColumnDef): Builder {
  const n = esc(col.name);
  switch (col.typeKind) {
    case 'int':
    case 'bigint':
      // SQLite has one INTEGER storage class for every integer size (its
      // own docs: booleans are even stored as INTEGER 0/1), so bigint gets
      // no separate builder here.
      return { importName: 'integer', call: `integer('${n}', { mode: 'number' })` };
    case 'decimal':
      // No fixed-point decimal storage class in SQLite; text keeps the
      // value exact, matching the string kind this package's TypeScript
      // output already uses for decimal for the same reason.
      return { importName: 'text', call: `text('${n}')` };
    case 'float':
      return { importName: 'real', call: `real('${n}')` };
    case 'boolean':
      return { importName: 'integer', call: `integer('${n}', { mode: 'boolean' })` };
    case 'string':
      return { importName: 'text', call: `text('${n}')` };
    case 'datetime':
      return { importName: 'text', call: `text('${n}')` };
    case 'json':
      return { importName: 'text', call: `text('${n}', { mode: 'json' })` };
    case 'bytes':
      return { importName: 'blob', call: `blob('${n}')` };
    case 'unknown':
      throw new Error('unreachable: unknown-typed columns are filtered out before emission');
  }
}

function tableFactoryFor(dialect: Dialect): { factory: string; corePackage: string } {
  if (dialect === 'postgresql') return { factory: 'pgTable', corePackage: 'drizzle-orm/pg-core' };
  if (dialect === 'mysql') return { factory: 'mysqlTable', corePackage: 'drizzle-orm/mysql-core' };
  return { factory: 'sqliteTable', corePackage: 'drizzle-orm/sqlite-core' };
}

function builderFor(dialect: Dialect, col: ColumnDef): Builder {
  if (dialect === 'postgresql') return pgBuilder(col);
  if (dialect === 'mysql') return mysqlBuilder(col);
  return sqliteBuilder(col);
}

function camelCase(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return 'table';
  return (
    words[0]!.toLowerCase() +
    words
      .slice(1)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join('')
  );
}

function isValidJsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function propName(columnName: string): string {
  return isValidJsIdentifier(columnName) ? columnName : JSON.stringify(columnName);
}

function defaultChain(col: ColumnDef): string {
  if (!col.default) return '';
  if (col.default.kind === 'now') return '.defaultNow()';
  const { valueType, value } = col.default;
  if (valueType === 'string') return `.default('${esc(value ?? '')}')`;
  if (valueType === 'number') return `.default(${value})`;
  if (valueType === 'boolean') return `.default(${(value ?? '').toLowerCase()})`;
  return ''; // a literal NULL default needs no chain; the column is already nullable
}

/**
 * Renders one `export const <camelTableName> = pgTable|mysqlTable|sqliteTable(...)`
 * per table, importing only the builders actually used. SQL Server is
 * refused outright (see DrizzleUnsupportedDialectError) because
 * drizzle-orm 0.45.3 ships no table builder for it at all.
 */
export function emitDrizzle(tables: TableDef[], dialect: Dialect): string {
  if (dialect === 'sqlserver') throw new DrizzleUnsupportedDialectError(dialect);

  const { factory, corePackage } = tableFactoryFor(dialect);
  const usedImports = new Set<string>([factory]);
  const seenNames = new Set<string>();
  let needsPrimaryKeyHelper = false;

  const blocks = tables.map((table) => {
    let varName = camelCase(table.name);
    while (seenNames.has(varName)) varName += 'Table';
    seenNames.add(varName);

    const compositeKey = table.columns.filter((c) => c.primaryKey);
    const useInlinePrimaryKey = compositeKey.length <= 1;

    const columnLines = table.columns.map((col) => {
      const builder = builderFor(dialect, col);
      usedImports.add(builder.importName);

      let chain = builder.call;
      if (!col.nullable) chain += '.notNull()';
      if (col.primaryKey && useInlinePrimaryKey) {
        chain += dialect === 'sqlite' && col.autoIncrement ? '.primaryKey({ autoIncrement: true })' : '.primaryKey()';
      } else if (dialect === 'mysql' && col.autoIncrement) {
        chain += '.autoincrement()';
      }
      chain += defaultChain(col);

      return `  ${propName(col.name)}: ${chain},`;
    });

    let extra = '';
    if (!useInlinePrimaryKey) {
      needsPrimaryKeyHelper = true;
      const cols = compositeKey.map((c) => `t.${propName(c.name)}`).join(', ');
      extra = `,\n  (t) => [primaryKey({ columns: [${cols}] })]`;
    }

    return `export const ${varName} = ${factory}('${esc(table.name)}', {\n${columnLines.join('\n')}\n}${extra});`;
  });

  if (needsPrimaryKeyHelper) usedImports.add('primaryKey');

  const importLine = `import { ${[...usedImports].sort().join(', ')} } from '${corePackage}';`;
  return importLine + '\n\n' + blocks.join('\n\n') + '\n';
}
