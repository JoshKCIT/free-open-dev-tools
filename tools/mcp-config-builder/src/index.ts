import meta from './meta.json';
import { setOwn } from './own-property';
import { CLIENTS, envVarNameFromKey, type ClientId, type RemoteTransport } from './clients';

export { meta };
export { CLIENTS, CLIENT_IDS, type ClientId, type RemoteTransport, type ClientDefinition } from './clients';

export class McpConfigError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'McpConfigError';
    this.field = field;
  }
}

export interface BuildMcpConfigOptions {
  client: ClientId;
  name: string;
  transport: 'stdio' | RemoteTransport;
  command?: string;
  /** One argument per line, kept exactly (no shell splitting -- a documented ambiguity: this tool cannot know how the visitor's shell would have split a single pasted command line). */
  args?: string;
  url?: string;
  /** "KEY=value" lines. */
  headers?: string;
  /** "KEY=value" lines. */
  env?: string;
  secretPlaceholders?: boolean;
}

export interface BuildMcpConfigResult {
  client: ClientId;
  fileName: string;
  output: string;
  warnings: string[];
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** A field or header name whose value is worth flagging even when it stays in plain text. */
const CREDENTIAL_KEY_PATTERN = /token|key|secret|password|passwd|credential|auth/i;

interface ParsedLine {
  key: string;
  value: string;
  line: number;
}

/**
 * Parses "KEY=value" lines (used for both env and headers): one entry per
 * line, split on the FIRST "=" only (so a value that itself contains "="
 * survives), blank lines skipped. A key repeated later in the same textarea
 * is reported rather than silently overwriting the earlier one.
 */
function parseKeyValueLines(text: string): { entries: ParsedLine[]; problems: string[] } {
  const entries: ParsedLine[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      problems.push(`Line ${index + 1}: "${raw}" has no "=", so it is not a KEY=value pair.`);
      return;
    }
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1);
    if (key === '') {
      problems.push(`Line ${index + 1}: this line has no key before "=".`);
      return;
    }
    if (seen.has(key)) {
      problems.push(`"${key}" is repeated; only its first value is kept.`);
      return;
    }
    seen.add(key);
    entries.push({ key, value, line: index + 1 });
  });

  return { entries, problems };
}

/** One argument per line, kept exactly. A fully blank line is dropped rather than becoming a literal empty-string argument -- a textarea's own trailing newline would otherwise always add one. */
function parseArgsLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line !== '')
    .map((line) => line.replace(/\r$/, ''));
}

function validateUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '') throw new McpConfigError('A remote server needs a URL.', 'url');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpConfigError(`"${value}" is not a URL this tool can parse.`, 'url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpConfigError(`A remote server's URL must be http: or https:, not "${parsed.protocol}".`, 'url');
  }
  return value;
}

export interface VscodeInput {
  type: 'promptString';
  id: string;
  description: string;
  password: true;
}

/**
 * Builds the env or headers object for one server entry, applying the
 * chosen client's own secret-placeholder mechanism (or none) to every
 * value when `secretPlaceholders` is on, and always flagging a
 * credential-shaped key whose value ends up written in plain text (AQ/D-105:
 * every phase 7 tool names what it cannot fully protect the visitor from).
 */
function buildValueMap(
  text: string,
  client: (typeof CLIENTS)[ClientId],
  secretPlaceholders: boolean,
  fieldLabel: string,
  vsCodeInputs: VscodeInput[],
  warnings: string[],
): Record<string, unknown> {
  const { entries, problems } = parseKeyValueLines(text);
  warnings.push(...problems);

  const result: Record<string, unknown> = {};
  const usedInputIds = new Set<string>();

  for (const { key, value } of entries) {
    let finalValue: string = value;

    if (secretPlaceholders) {
      if (client.placeholder.kind === 'template') {
        finalValue = client.placeholder.template(envVarNameFromKey(key));
      } else if (client.placeholder.kind === 'input') {
        let id = key
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (id === '' || usedInputIds.has(id)) id = `${id || 'value'}-${vsCodeInputs.length + 1}`;
        usedInputIds.add(id);
        vsCodeInputs.push({ type: 'promptString', id, description: `${fieldLabel} ${key}`, password: true });
        finalValue = `\${input:${id}}`;
      } else {
        warnings.push(
          `${client.label} does not document a placeholder form for secret values; "${key}" is written in plain text.`,
        );
      }
    }

    if (finalValue === value && CREDENTIAL_KEY_PATTERN.test(key)) {
      warnings.push(`"${key}" looks like it holds a credential, and is written in this file's own text.`);
    }

    setOwn(result, key, finalValue);
  }

  return result;
}

/**
 * Builds one MCP server configuration entry in the shape the chosen
 * client's own documentation shows (D-105): `meta.json`'s `standards` names
 * each client's own fetched page. Never starts, contacts or checks the
 * named server -- see `limits` for what only the client itself can show.
 */
export function buildMcpConfig(options: BuildMcpConfigOptions): BuildMcpConfigResult {
  const client = CLIENTS[options.client];
  if (!client) throw new McpConfigError(`"${options.client}" is not a client this tool supports.`, 'client');

  const name = (options.name ?? '').trim();
  if (!NAME_PATTERN.test(name)) {
    throw new McpConfigError(
      'A server name may only use letters, digits, "-" and "_", matching the documentation examples.',
      'name',
    );
  }

  const warnings: string[] = [];
  const vsCodeInputs: VscodeInput[] = [];
  const isRemote = options.transport !== 'stdio';
  const entry: Record<string, unknown> = {};

  if (!isRemote) {
    if (client.stdioNeedsType) setOwn(entry, 'type', 'stdio');
    const command = (options.command ?? '').trim();
    if (!command) throw new McpConfigError('A stdio server needs a command.', 'command');
    setOwn(entry, 'command', command);
    const args = parseArgsLines(options.args ?? '');
    if (args.length > 0) setOwn(entry, 'args', args);
    const env = buildValueMap(
      options.env ?? '',
      client,
      Boolean(options.secretPlaceholders),
      'Environment variable',
      vsCodeInputs,
      warnings,
    );
    if (Object.keys(env).length > 0) setOwn(entry, 'env', env);
  } else if (!client.supportsRemote) {
    warnings.push(`${client.label}'s own documentation does not describe a remote (url-based) server shape.`);
  } else {
    const transport = options.transport as RemoteTransport;
    if (!client.remoteTransports.includes(transport)) {
      warnings.push(
        `${client.label}'s own documentation does not describe a "${transport}" remote server; using its documented shape without a transport-specific field.`,
      );
    }
    const url = validateUrl(options.url);
    if (client.remoteNeedsType)
      setOwn(entry, 'type', client.remoteTransports.includes(transport) ? transport : client.remoteTransports[0]);
    setOwn(entry, 'url', url);
    const headers = buildValueMap(
      options.headers ?? '',
      client,
      Boolean(options.secretPlaceholders),
      'Header',
      vsCodeInputs,
      warnings,
    );
    if (Object.keys(headers).length > 0) setOwn(entry, 'headers', headers);
  }

  const root: Record<string, unknown> = {};
  if (vsCodeInputs.length > 0) setOwn(root, 'inputs', vsCodeInputs);
  const servers: Record<string, unknown> = {};
  setOwn(servers, name, entry);
  setOwn(root, client.topLevelKey, servers);

  return {
    client: client.id,
    fileName: client.fileName,
    output: JSON.stringify(root, null, 2),
    warnings,
  };
}
