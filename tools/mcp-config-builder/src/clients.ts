/**
 * One entry per MCP client this tool writes for, each fetched and cited to
 * that client's OWN documentation page (never "the MCP spec" -- D-105, this
 * phase's own research note that the remote shape is client-specific).
 * Every JSON shape and placeholder syntax quoted here is transcribed from a
 * real fetched example on that client's own page, fetched 2026-09-26.
 */
export type ClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode';

export type RemoteTransport = 'http' | 'sse';

/**
 * How a client lets a visitor avoid writing a literal secret into the file.
 * `none` means the client's own documentation never describes one (Claude
 * Desktop). `template` means a `${...}` reference the visitor's own shell
 * or client resolves later, built by `template(fieldKey)`. `input` (VS Code
 * only) means a top-level `inputs` array entry the value references by id --
 * built separately in `index.ts` because it changes the document's shape,
 * not just one field's value.
 */
export type PlaceholderKind =
  { kind: 'none' } | { kind: 'template'; template: (envVarName: string) => string } | { kind: 'input' };

export interface ClientDefinition {
  id: ClientId;
  label: string;
  /** The file this client reads, exactly as its own page names it. */
  fileName: string;
  /** Where that file goes, in this project's own words (D-105 AM3: never pasted from the client's page). */
  fileLocationNote: string;
  /** The top-level key holding the map of server entries. */
  topLevelKey: string;
  /** True when this client's page documents a remote (url-based) server shape at all. */
  supportsRemote: boolean;
  /** True when a remote entry needs an explicit "type" field naming its transport. Cursor's remote shape needs none -- a bare "url" is enough. */
  remoteNeedsType: boolean;
  /** Transports this client's page documents for a remote entry, in the order offered. */
  remoteTransports: RemoteTransport[];
  /** True when this client's stdio entry itself carries an explicit "type": "stdio" field (VS Code only; the other three infer stdio from the presence of "command"). */
  stdioNeedsType: boolean;
  placeholder: PlaceholderKind;
  docsUrl: string;
}

/**
 * Turns a field's own key ("API_KEY", "Authorization") into an
 * environment-variable-shaped name for a template placeholder: upper-cased,
 * with every character that is not a letter, digit or underscore replaced
 * by one, and a leading digit prefixed with an underscore so the result is
 * always a legal shell/env variable name.
 */
export function envVarNameFromKey(key: string): string {
  const upper = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return /^[0-9]/.test(upper) ? `_${upper}` : upper || 'VALUE';
}

export const CLIENTS: Record<ClientId, ClientDefinition> = {
  'claude-desktop': {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    fileName: 'claude_desktop_config.json',
    fileLocationNote:
      'macOS: ~/Library/Application Support/Claude/claude_desktop_config.json. Windows: %APPDATA%\\Claude\\claude_desktop_config.json.',
    topLevelKey: 'mcpServers',
    supportsRemote: false,
    remoteNeedsType: false,
    remoteTransports: [],
    stdioNeedsType: false,
    placeholder: { kind: 'none' },
    docsUrl: 'https://modelcontextprotocol.io/quickstart/user',
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    fileName: '.mcp.json',
    fileLocationNote: 'At the root of the project, so the team can commit and share it.',
    topLevelKey: 'mcpServers',
    supportsRemote: true,
    remoteNeedsType: true,
    remoteTransports: ['http', 'sse'],
    stdioNeedsType: false,
    placeholder: { kind: 'template', template: (name) => `\${${name}}` },
    docsUrl: 'https://docs.claude.com/en/docs/claude-code/mcp',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    fileName: 'mcp.json',
    fileLocationNote: 'Project: .cursor/mcp.json. Global (every project): ~/.cursor/mcp.json.',
    topLevelKey: 'mcpServers',
    supportsRemote: true,
    remoteNeedsType: false,
    remoteTransports: ['http', 'sse'],
    stdioNeedsType: false,
    placeholder: { kind: 'template', template: (name) => `\${env:${name}}` },
    docsUrl: 'https://cursor.com/docs/mcp',
  },
  vscode: {
    id: 'vscode',
    label: 'VS Code',
    fileName: 'mcp.json',
    fileLocationNote: 'Workspace: .vscode/mcp.json. User profile: run "MCP: Open User Configuration".',
    topLevelKey: 'servers',
    supportsRemote: true,
    remoteNeedsType: true,
    remoteTransports: ['http', 'sse'],
    stdioNeedsType: true,
    placeholder: { kind: 'input' },
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
  },
};

export const CLIENT_IDS: ClientId[] = ['claude-desktop', 'claude-code', 'cursor', 'vscode'];
