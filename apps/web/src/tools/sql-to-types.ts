import { meta, sqlToTypes, SqlToTypesError, type Dialect, type Target } from '@fodt/sql-to-types';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DIALECT_LABELS: Record<Dialect, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
};

const TARGET_LABELS: Record<Target, string> = {
  typescript: 'TypeScript',
  prisma: 'Prisma',
  drizzle: 'Drizzle',
};

const TARGET_LANGUAGE: Record<Target, string> = {
  typescript: 'typescript',
  prisma: 'prisma',
  drizzle: 'typescript',
};

export default defineTool({
  id: 'sql-to-types',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'dialect',
      label: 'SQL dialect',
      type: 'select',
      default: 'postgresql',
      options: (['postgresql', 'mysql', 'sqlite', 'sqlserver'] as Dialect[]).map((d) => ({
        value: d,
        label: DIALECT_LABELS[d],
      })),
    },
    {
      name: 'target',
      label: 'Target',
      type: 'select',
      default: 'typescript',
      options: (['typescript', 'prisma', 'drizzle'] as Target[]).map((t) => ({ value: t, label: TARGET_LABELS[t] })),
    },
    {
      name: 'input',
      label: 'CREATE TABLE statements',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'A single table',
      values: {
        input: 'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, bio text);',
        dialect: 'postgresql',
      },
    },
    {
      label: 'MySQL with AUTO_INCREMENT and a boolean flag',
      values: {
        input: 'CREATE TABLE users (id int PRIMARY KEY AUTO_INCREMENT, active tinyint(1) DEFAULT 1);',
        dialect: 'mysql',
      },
    },
    {
      label: 'Something outside the subset',
      values: {
        input: 'CREATE TABLE users (id integer PRIMARY KEY, email text UNIQUE);',
        dialect: 'postgresql',
      },
    },
    {
      label: 'Prisma schema',
      values: {
        input: 'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL);',
        dialect: 'postgresql',
        target: 'prisma',
      },
    },
    {
      label: 'Drizzle table definition',
      values: {
        input: 'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL);',
        dialect: 'postgresql',
        target: 'drizzle',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const dialect = str(values, 'dialect', 'postgresql') as Dialect;
    const target = str(values, 'target', 'typescript') as Target;

    try {
      const result = sqlToTypes(input, { dialect, target });
      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Output', language: TARGET_LANGUAGE[target], value: result.output },
      ];
      if (result.notConverted.length > 0) {
        outputs.push({
          kind: 'list',
          label: `Not converted (${result.notConverted.length})`,
          items: result.notConverted.map((n) => `line ${n.line}: ${n.text}: ${n.reason}`),
        });
      }
      return {
        outputs,
        stats: [
          ['Tables', String(result.tables.length)],
          ['Columns', String(result.tables.reduce((sum, t) => sum + t.columns.length, 0))],
        ],
      };
    } catch (err) {
      if (err instanceof SqlToTypesError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
