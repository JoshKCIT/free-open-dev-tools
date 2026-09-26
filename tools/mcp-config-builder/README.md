# MCP Config Builder

Build a Model Context Protocol server configuration file.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Writes one MCP (Model Context Protocol) server entry in the exact shape Claude Desktop, Claude Code, Cursor or VS Code documents for its own configuration file -- the right top-level key, the right field names, and each client's own way of referring to a secret without writing it in plain text where that client documents one. Nothing typed here is sent anywhere; the file is built entirely in this tab.

## Supported

- A local (stdio) server entry with a command, one argument per line and environment variables, for all four clients
- A remote (HTTP or SSE) server entry with a URL and headers, for Claude Code, Cursor and VS Code
- Each client's own placeholder form for a secret value: Claude Code and Cursor write a ${VAR} or ${env:VAR} reference the visitor's own shell resolves; VS Code adds an inputs entry that prompts the visitor and stores the answer; Claude Desktop documents no placeholder form, so a value stays in plain text with a warning
- A warning whenever an environment variable or header name looks like it holds a credential (token, key, secret, password) and its value ends up written in plain text
- Round-tripping every value, including quotes, backslashes and line breaks, through JSON.stringify's own escaping

## Limits

- This tool cannot start the named server, check that its command exists on the visitor's own machine, or confirm that a remote URL answers -- only actually running the client can show that.
- This tool cannot check that the visitor's installed version of Claude Desktop, Claude Code, Cursor or VS Code still accepts the exact shape shown here; every client's own configuration file format can change between releases, and this tool reflects each page as fetched on 2026-09-26.
- This tool cannot tell whether a package named in a stdio command's arguments is trustworthy or does what its name suggests -- that judgement is the visitor's own.

## Ambiguous cases, and what this does about them

- Arguments are read one per line and passed through exactly, never split the way a shell would split one pasted command line -- there is no way for this tool to know which shell the visitor intends, so a multi-word argument must go on its own line.
- A fully blank line in the arguments field is dropped rather than becoming a literal empty-string argument, since a textarea's own trailing newline would otherwise always add one.
- VS Code's own inputs mechanism needs an id for each secret; this tool derives one from the environment variable or header name (lower-cased, non-letters and non-digits replaced by a hyphen), which is readable but not itself part of VS Code's documented contract.

## Defined by

- [Model Context Protocol -- Connect local MCP servers](https://modelcontextprotocol.io/quickstart/user)
- [Claude Code MCP documentation](https://docs.claude.com/en/docs/claude-code/mcp)
- [Cursor MCP documentation](https://cursor.com/docs/mcp)
- [VS Code MCP server configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/mcp-config-builder mcp-config-builder
cd mcp-config-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/mcp-config-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildMcpConfig } from '@fodt/mcp-config-builder';

const result = buildMcpConfig({ client: 'claude-desktop', name: 'filesystem', transport: 'stdio', command: 'npx', args: '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Desktop' });
console.log(result.output);
```

`buildMcpConfig` always returns a `BuildMcpConfigResult` -- `client`, `fileName`, `output` (the whole file's text) and `warnings`; it throws `McpConfigError` (with a `field` naming which input was wrong) only for a name, command or URL the documentation does not allow.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Each client's output shape is checked directly against a quoted example transcribed from that client's own fetched documentation page, so a passing test proves this tool matches what the client itself publishes, not an assumption about a shared MCP configuration format that does not exist.

## Licence

MIT. See [LICENSE](./LICENSE).
