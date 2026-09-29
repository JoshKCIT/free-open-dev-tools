import {
  meta,
  scramSha256,
  postgresMd5,
  mysqlNativePassword,
  alterRolePostgres,
  alterUserMysql,
  alterUserMariadb,
  identifierLengthWarning,
  verifyStoredHash,
  MATCH_MESSAGE,
  NO_MATCH_MESSAGE,
  DbHashError,
  SCRAM_ITERATIONS,
} from '@fodt/db-password-hash';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

type Mode = 'generate' | 'verify';
type Format = 'scram-sha-256' | 'postgres-md5' | 'mysql-native';

/** Never lets a raw error, or any part of a password, reach the visitor (S1/S2). */
function errorMessage(err: unknown): string {
  if (err instanceof DbHashError) return err.message;
  return 'This could not be processed. Check the input and try again.';
}

export default defineTool({
  id: 'db-password-hash',
  // Hashing or verifying as the visitor types would run on every half-typed
  // password, like bcrypt and jwt-signature.
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'generate',
      options: [
        { value: 'generate', label: 'Generate a stored hash' },
        { value: 'verify', label: 'Check a password against a stored hash' },
      ],
    },
    {
      name: 'format',
      label: 'Format',
      type: 'select',
      default: 'scram-sha-256',
      options: [
        { value: 'scram-sha-256', label: 'PostgreSQL SCRAM-SHA-256' },
        { value: 'postgres-md5', label: 'PostgreSQL md5 (legacy)' },
        { value: 'mysql-native', label: 'MySQL and MariaDB mysql_native_password' },
      ],
      visible: (v) => v.mode === 'generate',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      placeholder: 'Never shown in the output.',
    },
    {
      name: 'role',
      label: 'Role or user name',
      type: 'text',
      visible: (v) =>
        v.mode === 'generate' || (v.mode === 'verify' && str(v, 'stored').trim().toLowerCase().startsWith('md5')),
    },
    {
      name: 'host',
      label: 'Host',
      type: 'text',
      default: '%',
      visible: (v) => v.mode === 'generate' && v.format === 'mysql-native',
    },
    {
      name: 'iterations',
      label: 'Iterations',
      type: 'number',
      default: SCRAM_ITERATIONS.default,
      min: SCRAM_ITERATIONS.min,
      max: SCRAM_ITERATIONS.max,
      visible: (v) => v.mode === 'generate' && v.format === 'scram-sha-256',
    },
    {
      name: 'salt',
      label: 'Salt (Base64, optional)',
      type: 'text',
      mono: true,
      help: 'Empty means 16 random bytes.',
      visible: (v) => v.mode === 'generate' && v.format === 'scram-sha-256',
    },
    {
      name: 'stored',
      label: 'Stored hash',
      type: 'textarea',
      rows: 3,
      mono: true,
      placeholder: 'SCRAM-SHA-256$4096:... or md5... or *...',
      visible: (v) => v.mode === 'verify',
    },
  ],
  examples: [
    {
      label: 'PostgreSQL SCRAM-SHA-256',
      values: {
        mode: 'generate',
        format: 'scram-sha-256',
        password: 'pencil',
        role: 'app_user',
        salt: 'W22ZaJ0SNY7soEsUEjb6gQ==',
        iterations: 4096,
      },
    },
    {
      label: 'MySQL native password',
      values: { mode: 'generate', format: 'mysql-native', password: 'mypass', role: 'app_user', host: '%' },
    },
    {
      label: 'Check a MySQL hash',
      values: { mode: 'verify', password: 'mypass', stored: '*6C8989366EAF75BB670AD8EA7A7FC1176A95CEF4' },
    },
  ],
  async run(values): Promise<ToolResult> {
    const mode = str(values, 'mode', 'generate') as Mode;
    const password = str(values, 'password');

    if (mode === 'verify') {
      const stored = str(values, 'stored');
      if (!password || !stored.trim()) return { outputs: [] };
      try {
        return await runVerify(values, password, stored);
      } catch (err) {
        return { outputs: [], errors: [{ message: errorMessage(err) }] };
      }
    }

    if (!password) return { outputs: [] };
    try {
      return await runGenerate(values, password);
    } catch (err) {
      return { outputs: [], errors: [{ message: errorMessage(err) }] };
    }
  },
});

async function runGenerate(values: Record<string, unknown>, password: string): Promise<ToolResult> {
  const format = str(values, 'format', 'scram-sha-256') as Format;
  const role = str(values, 'role').trim();

  if (format === 'scram-sha-256') {
    const iterations = Math.round(num(values, 'iterations', SCRAM_ITERATIONS.default));
    const saltText = str(values, 'salt').trim();
    const result = await scramSha256(password, { iterations, salt: saltText || undefined });
    const outputs: OutputBlock[] = [{ kind: 'code', label: 'Stored hash', value: result.stored }];
    if (role) {
      outputs.push({ kind: 'code', label: 'SQL', language: 'sql', value: alterRolePostgres(role, result.stored) });
    } else {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: 'Enter a role name above to get a ready ALTER ROLE statement.',
      });
    }
    outputs.push({
      kind: 'note',
      tone: 'warn',
      value:
        'PostgreSQL SCRAM-SHA-256 has no configurable work factor comparable to bcrypt or scrypt; the iteration count above is how PostgreSQL tunes it.',
    });
    for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
    if (role) {
      const lengthWarning = identifierLengthWarning(role);
      if (lengthWarning) outputs.push({ kind: 'note', tone: 'warn', value: lengthWarning });
    }
    return {
      outputs,
      stats: [
        ['Kind', 'SCRAM-SHA-256'],
        ['Iterations', String(iterations)],
      ],
    };
  }

  if (format === 'postgres-md5') {
    if (!role) {
      throw new DbHashError(
        'A PostgreSQL md5 hash is salted with the role name: enter the role name it was created for.',
      );
    }
    const hash = postgresMd5(password, role);
    const outputs: OutputBlock[] = [
      { kind: 'code', label: 'Stored hash', value: hash },
      { kind: 'code', label: 'SQL', language: 'sql', value: alterRolePostgres(role, hash) },
      {
        kind: 'note',
        tone: 'warn',
        value: 'PostgreSQL md5 is deprecated since PostgreSQL 14 and was removed as a default authentication method.',
      },
    ];
    const lengthWarning = identifierLengthWarning(role);
    if (lengthWarning) outputs.push({ kind: 'note', tone: 'warn', value: lengthWarning });
    return { outputs, stats: [['Kind', 'PostgreSQL md5']] };
  }

  // mysql-native
  const host = str(values, 'host', '%') || '%';
  const hash = mysqlNativePassword(password);
  const outputs: OutputBlock[] = [{ kind: 'code', label: 'Stored hash', value: hash }];
  if (role) {
    outputs.push({
      kind: 'code',
      label: 'SQL',
      language: 'sql',
      value: `-- MySQL\n${alterUserMysql(role, host, hash)}\n-- MariaDB\n${alterUserMariadb(role, host, hash)}`,
    });
  } else {
    outputs.push({ kind: 'note', tone: 'info', value: 'Enter a role name above to get ready ALTER USER statements.' });
  }
  outputs.push({
    kind: 'note',
    tone: 'warn',
    value:
      'mysql_native_password is the default on MariaDB, but is deprecated in MySQL 8.0, disabled by default from MySQL 8.4, and removed in MySQL 9.0.',
  });
  return { outputs, stats: [['Kind', 'MySQL/MariaDB mysql_native_password']] };
}

async function runVerify(values: Record<string, unknown>, password: string, stored: string): Promise<ToolResult> {
  const role = str(values, 'role').trim();
  const result = await verifyStoredHash(stored, password, { role: role || undefined });
  const outputs: OutputBlock[] = [
    { kind: 'note', tone: result.match ? 'success' : 'error', value: result.match ? MATCH_MESSAGE : NO_MATCH_MESSAGE },
  ];
  for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
  const stats: [string, string][] = [['Kind', result.kind]];
  if (result.iterations !== undefined) stats.push(['Iterations', String(result.iterations)]);
  return { outputs, stats };
}
