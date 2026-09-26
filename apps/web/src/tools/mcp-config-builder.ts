import { meta, buildMcpConfig, McpConfigError, CLIENTS, CLIENT_IDS } from '@fodt/mcp-config-builder';
import { defineTool, str, bool, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const isRemote = (values: Values) => str(values, 'transport', 'stdio') !== 'stdio';

export default defineTool({
  id: 'mcp-config-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'client',
      label: 'Client',
      type: 'select',
      default: 'claude-desktop',
      options: CLIENT_IDS.map((id) => ({ value: id, label: CLIENTS[id].label })),
    },
    { name: 'name', label: 'Server name', type: 'text', default: 'my-server' },
    {
      name: 'transport',
      label: 'Transport',
      type: 'radio',
      default: 'stdio',
      options: [
        { value: 'stdio', label: 'stdio (a local command)' },
        { value: 'http', label: 'HTTP (a remote server)' },
        { value: 'sse', label: 'SSE (a remote server)' },
      ],
    },
    { name: 'command', label: 'Command', type: 'text', placeholder: 'npx', visible: (v) => !isRemote(v) },
    {
      name: 'args',
      label: 'Arguments (one per line)',
      type: 'textarea',
      rows: 4,
      placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Desktop',
      visible: (v) => !isRemote(v),
    },
    {
      name: 'url',
      label: 'URL',
      type: 'text',
      placeholder: 'https://example.invalid/mcp',
      visible: (v) => isRemote(v),
    },
    {
      name: 'headers',
      label: 'Headers (KEY=value, one per line)',
      type: 'textarea',
      rows: 3,
      visible: (v) => isRemote(v),
    },
    { name: 'env', label: 'Environment variables (KEY=value, one per line)', type: 'textarea', rows: 3 },
    { name: 'secretPlaceholders', label: 'Replace secret values with a placeholder', type: 'checkbox', default: true },
  ],
  examples: [
    {
      label: 'A local filesystem server for Claude Desktop',
      values: {
        client: 'claude-desktop',
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Desktop',
      },
    },
  ],
  run(values): ToolResult {
    const name = str(values, 'name');
    if (!name.trim()) return { outputs: [] };
    const client = str(values, 'client', 'claude-desktop') as keyof typeof CLIENTS;
    const transport = str(values, 'transport', 'stdio') as 'stdio' | 'http' | 'sse';

    try {
      const result = buildMcpConfig({
        client,
        name,
        transport,
        command: str(values, 'command'),
        args: str(values, 'args'),
        url: str(values, 'url'),
        headers: str(values, 'headers'),
        env: str(values, 'env'),
        secretPlaceholders: bool(values, 'secretPlaceholders', true),
      });

      const def = CLIENTS[client];
      const outputs: OutputBlock[] = [
        { kind: 'code', label: result.fileName, language: 'json', value: result.output, download: result.fileName },
        { kind: 'note', tone: 'info', value: `This file goes here: ${def.fileLocationNote}` },
      ];
      for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });

      return { outputs, warnings: result.warnings };
    } catch (err) {
      if (err instanceof McpConfigError) {
        return { outputs: [], errors: [{ message: err.message, path: err.field }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This configuration could not be built.' }],
      };
    }
  },
});
