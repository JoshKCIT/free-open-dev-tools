import { it, expect, vi } from 'vitest';
import { buildMcpConfig, McpConfigError, meta } from '../src/index';

/**
 * Quoted from the Model Context Protocol's own "Connect local MCP servers"
 * quickstart (https://modelcontextprotocol.io/quickstart/user, fetched
 * 2026-09-26), the claude_desktop_config.json example:
 *
 *   {
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": [
 *           "-y",
 *           "@modelcontextprotocol/server-filesystem",
 *           "/Users/username/Desktop",
 *           "/Users/username/Downloads"
 *         ]
 *       }
 *     }
 *   }
 */
it('a stdio server is written in the mcpServers shape the Model Context Protocol documentation shows', () => {
  const result = buildMcpConfig({
    client: 'claude-desktop',
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Desktop',
  });
  const parsed = JSON.parse(result.output);
  expect(parsed).toEqual({
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/Desktop'],
      },
    },
  });
  expect(result.fileName).toBe('claude_desktop_config.json');
});

/**
 * Each client's own documentation example, transcribed and fetched
 * 2026-09-26:
 * - Claude Code (https://docs.claude.com/en/docs/claude-code/mcp):
 *   {"mcpServers":{"example":{"command":"npx","args":["-y","@example/mcp-server"]}}}
 * - Cursor (https://cursor.com/docs/mcp), "CLI Server - Node.js":
 *   {"mcpServers":{"server-name":{"command":"npx","args":["-y","mcp-server"],"env":{"API_KEY":"value"}}}}
 * - VS Code (https://code.visualstudio.com/docs/agents/reference/mcp-configuration),
 *   the "playwright" entry of its mcp.json example:
 *   {"servers":{"playwright":{"type":"stdio","command":"npx","args":["-y","@microsoft/mcp-server-playwright"]}}}
 */
it('each client target matches the example on that client documentation page', () => {
  const claudeCode = buildMcpConfig({
    client: 'claude-code',
    name: 'example',
    transport: 'stdio',
    command: 'npx',
    args: '-y\n@example/mcp-server',
  });
  expect(JSON.parse(claudeCode.output)).toEqual({
    mcpServers: { example: { command: 'npx', args: ['-y', '@example/mcp-server'] } },
  });

  const cursor = buildMcpConfig({
    client: 'cursor',
    name: 'server-name',
    transport: 'stdio',
    command: 'npx',
    args: '-y\nmcp-server',
    env: 'API_KEY=value',
  });
  expect(JSON.parse(cursor.output)).toEqual({
    mcpServers: { 'server-name': { command: 'npx', args: ['-y', 'mcp-server'], env: { API_KEY: 'value' } } },
  });

  const vscode = buildMcpConfig({
    client: 'vscode',
    name: 'playwright',
    transport: 'stdio',
    command: 'npx',
    args: '-y\n@microsoft/mcp-server-playwright',
  });
  expect(JSON.parse(vscode.output)).toEqual({
    servers: { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@microsoft/mcp-server-playwright'] } },
  });
  expect(vscode.fileName).toBe('mcp.json');
});

/**
 * Remote shapes, quoted from each client's own page (fetched 2026-09-26):
 * - Claude Code: {"type":"ws","url":"wss://...","headers":{...}} pattern
 *   (this test uses "http", the same field shape) --
 *   a "url" with no "type" is a configuration error on Claude Code
 *   ("MCP server "<name>" has a "url" but no "type"").
 * - Cursor: {"mcpServers":{"server-name":{"url":"http://localhost:3000/mcp","headers":{"API_KEY":"value"}}}}
 *   -- no "type" field at all.
 * - VS Code: {"servers":{"github":{"type":"http","url":"https://api.githubcopilot.com/mcp"}}}
 * - Claude Desktop's own quickstart never shows a "url"/remote shape.
 */
it('a remote server uses the url and type shape only for clients that document it', () => {
  const claudeCode = buildMcpConfig({
    client: 'claude-code',
    name: 'api',
    transport: 'http',
    url: 'https://api.example.com/mcp',
  });
  expect(JSON.parse(claudeCode.output)).toEqual({
    mcpServers: { api: { type: 'http', url: 'https://api.example.com/mcp' } },
  });

  const cursor = buildMcpConfig({
    client: 'cursor',
    name: 'server-name',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    headers: 'API_KEY=value',
  });
  expect(JSON.parse(cursor.output)).toEqual({
    mcpServers: { 'server-name': { url: 'http://localhost:3000/mcp', headers: { API_KEY: 'value' } } },
  });
  // Cursor's own documented shape has no "type" field for a remote entry.
  expect(cursor.output.includes('"type"')).toBe(false);

  const vscode = buildMcpConfig({
    client: 'vscode',
    name: 'github',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp',
  });
  expect(JSON.parse(vscode.output)).toEqual({
    servers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp' } },
  });

  const desktop = buildMcpConfig({
    client: 'claude-desktop',
    name: 'api',
    transport: 'http',
    url: 'https://api.example.com/mcp',
  });
  expect(JSON.parse(desktop.output)).toEqual({ mcpServers: { api: {} } });
  expect(desktop.warnings.some((w) => w.includes('does not describe a remote'))).toBe(true);
});

it('every value, including quotes, backslashes and line breaks, round trips through the generated JSON', () => {
  const result = buildMcpConfig({
    client: 'claude-code',
    name: 'hostile',
    transport: 'stdio',
    command: 'python',
    args: 'C:\\Program Files\\server.py\n--flag="value with spaces"\nline1\nline2',
    env: 'MESSAGE=Contains "quotes", a \\backslash\\ and\nan embedded newline',
  });
  const parsed = JSON.parse(result.output);
  expect(parsed.mcpServers.hostile.args).toEqual([
    'C:\\Program Files\\server.py',
    '--flag="value with spaces"',
    'line1',
    'line2',
  ]);
  expect(parsed.mcpServers.hostile.env.MESSAGE).toBe('Contains "quotes", a \\backslash\\ and');
});

/**
 * Quoted from VS Code's own MCP configuration reference (fetched
 * 2026-09-26), the "perplexity" input-variable example:
 *   {
 *     "inputs": [{ "type": "promptString", "id": "perplexity-key", "description": "Perplexity API Key", "password": true }],
 *     "servers": { "perplexity": { "type": "stdio", "command": "npx", "args": ["-y", "server-perplexity-ask"],
 *       "env": { "PERPLEXITY_API_KEY": "${input:perplexity-key}" } } }
 *   }
 * Claude Code and Cursor write a ${VAR}/${env:VAR} reference instead
 * (docs.claude.com and cursor.com, same fetch date); Claude Desktop's own
 * quickstart documents no placeholder form at all.
 */
it('secret values can be replaced by the placeholder form each client documents', () => {
  const vscode = buildMcpConfig({
    client: 'vscode',
    name: 'perplexity',
    transport: 'stdio',
    command: 'npx',
    args: '-y\nserver-perplexity-ask',
    env: 'PERPLEXITY_API_KEY=sk-real-secret-value',
    secretPlaceholders: true,
  });
  const parsedVscode = JSON.parse(vscode.output);
  expect(parsedVscode.servers.perplexity.env.PERPLEXITY_API_KEY).toMatch(/^\$\{input:[a-z0-9-]+\}$/);
  const inputId = parsedVscode.servers.perplexity.env.PERPLEXITY_API_KEY.slice(8, -1);
  expect(parsedVscode.inputs).toEqual([
    { type: 'promptString', id: inputId, description: 'Environment variable PERPLEXITY_API_KEY', password: true },
  ]);
  expect(vscode.output.includes('sk-real-secret-value')).toBe(false);

  const claudeCode = buildMcpConfig({
    client: 'claude-code',
    name: 'api',
    transport: 'http',
    url: 'https://api.example.com/mcp',
    headers: 'Authorization=Bearer sk-real-secret-value',
    secretPlaceholders: true,
  });
  expect(JSON.parse(claudeCode.output).mcpServers.api.headers.Authorization).toBe('${AUTHORIZATION}');
  expect(claudeCode.output.includes('sk-real-secret-value')).toBe(false);

  const cursor = buildMcpConfig({
    client: 'cursor',
    name: 'api',
    transport: 'http',
    url: 'https://api.example.com/mcp',
    headers: 'Authorization=Bearer sk-real-secret-value',
    secretPlaceholders: true,
  });
  expect(JSON.parse(cursor.output).mcpServers.api.headers.Authorization).toBe('${env:AUTHORIZATION}');

  const desktop = buildMcpConfig({
    client: 'claude-desktop',
    name: 'server',
    transport: 'stdio',
    command: 'npx',
    env: 'API_KEY=sk-real-secret-value',
    secretPlaceholders: true,
  });
  expect(JSON.parse(desktop.output).mcpServers.server.env.API_KEY).toBe('sk-real-secret-value');
  expect(desktop.warnings.some((w) => w.includes('does not document a placeholder form'))).toBe(true);
  expect(desktop.warnings.some((w) => w.includes('credential'))).toBe(true);
});

it('a server name, command or URL the documentation does not allow is reported', () => {
  expect(() =>
    buildMcpConfig({ client: 'claude-desktop', name: 'has a space', transport: 'stdio', command: 'npx' }),
  ).toThrow(McpConfigError);
  try {
    buildMcpConfig({ client: 'claude-desktop', name: 'has a space', transport: 'stdio', command: 'npx' });
  } catch (err) {
    expect(err).toBeInstanceOf(McpConfigError);
    expect((err as McpConfigError).field).toBe('name');
  }

  expect(() => buildMcpConfig({ client: 'claude-desktop', name: 'ok', transport: 'stdio', command: '' })).toThrow(
    McpConfigError,
  );

  expect(() => buildMcpConfig({ client: 'claude-code', name: 'ok', transport: 'http', url: 'not a url' })).toThrow(
    McpConfigError,
  );
  expect(() =>
    buildMcpConfig({ client: 'claude-code', name: 'ok', transport: 'http', url: 'ftp://example.com/mcp' }),
  ).toThrow(McpConfigError);
});

it('nothing is written to the console while building', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    buildMcpConfig({
      client: 'vscode',
      name: 'ok',
      transport: 'stdio',
      command: 'npx',
      args: '-y\nsome-server',
      env: 'A=1\nB=2',
      secretPlaceholders: true,
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('meta names this tool', () => {
  expect(meta.id).toBe('mcp-config-builder');
});
